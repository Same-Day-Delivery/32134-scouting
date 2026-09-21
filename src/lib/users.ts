import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { openDb } from './db';

/**
 * User accounts and the login log, in the same SQLite file as the scoring
 * data. A handful of shared logins for one team - not a system that needs
 * email, password reset or roles beyond "admin or not".
 */

export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Bumped on a password change, which invalidates that user's cookies. */
  tokenVersion: number;
}

export interface LoginEvent {
  id: number;
  username: string;
  ok: boolean;
  at: string;
  ip: string | null;
  userAgent: string | null;
  note: string | null;
}

let ready = false;

function conn() {
  const db = openDb();
  if (ready) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY,
      -- NOCASE so "Scout" and "scout" cannot become two accounts.
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      last_login_at TEXT,
      token_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS login_events (
      id         INTEGER PRIMARY KEY,
      user_id    INTEGER,
      -- Kept as text as well as by id: a failed attempt may name no real
      -- account, and a deleted account should not erase its own history.
      username   TEXT NOT NULL,
      ok         INTEGER NOT NULL,
      at         TEXT NOT NULL,
      ip         TEXT,
      user_agent TEXT,
      note       TEXT
    );
    CREATE INDEX IF NOT EXISTS login_events_at ON login_events (at DESC);
  `);
  ready = true;
  return db;
}

/* ----------------------------------------------------------------- hashing */

const KEYLEN = 64;

/** `scrypt$<salt hex>$<hash hex>`; the salt is per user, so equal passwords differ. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEYLEN) return false;
  return timingSafeEqual(scryptSync(password, Buffer.from(saltHex, 'hex'), KEYLEN), expected);
}

/** Burns roughly the time a real check costs, so a missing user is not faster. */
function dummyVerify() {
  scryptSync('', randomBytes(16), KEYLEN);
}

/* ------------------------------------------------------------------- rules */

export const USERNAME_RULE = 'letters, numbers, dot, dash and underscore; 3-32 characters';

export function validateUsername(name: string): string | null {
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(name)) return `Username must be ${USERNAME_RULE}.`;
  return null;
}

/**
 * No length rule: a handful of shared logins on a team dashboard, not a public
 * site. A blank password is still refused, since that is an account with no
 * password at all rather than a short one.
 */
export function validatePassword(password: string): string | null {
  if (password.length === 0) return 'Password cannot be blank.';
  return null;
}

/* ------------------------------------------------------------------ reads */

const toUser = (r: any): User => ({
  id: Number(r.id),
  username: String(r.username),
  isAdmin: Boolean(r.is_admin),
  createdAt: String(r.created_at),
  lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
  tokenVersion: Number(r.token_version),
});

const COLUMNS = 'id, username, is_admin, created_at, last_login_at, token_version';

export function listUsers(): User[] {
  return (conn().prepare(`SELECT ${COLUMNS} FROM users ORDER BY is_admin DESC, username`).all() as any[]).map(toUser);
}

export function getUser(id: number): User | null {
  const row = conn().prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as any;
  return row ? toUser(row) : null;
}

export function countAdmins(): number {
  const row = conn().prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get() as any;
  return Number(row.n);
}

/* ------------------------------------------------------------------ writes */

export function createUser(username: string, password: string, isAdmin: boolean): User {
  const db = conn();
  db.prepare(
    'INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)',
  ).run(username, hashPassword(password), isAdmin ? 1 : 0, new Date().toISOString());
  const row = db.prepare(`SELECT ${COLUMNS} FROM users WHERE username = ?`).get(username) as any;
  return toUser(row);
}

export function usernameTaken(username: string): boolean {
  return Boolean(conn().prepare('SELECT 1 FROM users WHERE username = ?').get(username));
}

/** Bumping token_version signs the user out everywhere they are signed in. */
export function setPassword(id: number, password: string) {
  conn()
    .prepare(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    )
    .run(hashPassword(password), id);
}

export function setAdmin(id: number, isAdmin: boolean) {
  conn().prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
}

export function deleteUser(id: number) {
  // login_events keeps its rows: the log is a record of what happened, and
  // deleting an account should not rewrite it.
  conn().prepare('DELETE FROM users WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------- login */

/** Returns the user on a correct username/password pair, else null. */
export function authenticate(username: string, password: string): User | null {
  const row = conn()
    .prepare(`SELECT ${COLUMNS}, password_hash FROM users WHERE username = ?`)
    .get(username) as any;

  if (!row) {
    dummyVerify();
    return null;
  }
  if (!verifyPassword(password, String(row.password_hash))) return null;
  return toUser(row);
}

export function markLoggedIn(id: number) {
  conn().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function recordLogin(event: {
  userId: number | null;
  username: string;
  ok: boolean;
  ip: string | null;
  userAgent: string | null;
  note?: string | null;
}) {
  conn()
    .prepare(
      'INSERT INTO login_events (user_id, username, ok, at, ip, user_agent, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      event.userId,
      event.username,
      event.ok ? 1 : 0,
      new Date().toISOString(),
      event.ip,
      // Long enough to tell phones from laptops, short enough to stay readable.
      event.userAgent ? event.userAgent.slice(0, 200) : null,
      event.note ?? null,
    );
}

export function listLoginEvents(limit = 200): LoginEvent[] {
  return (
    conn()
      .prepare('SELECT id, username, ok, at, ip, user_agent, note FROM login_events ORDER BY at DESC, id DESC LIMIT ?')
      .all(limit) as any[]
  ).map((r) => ({
    id: Number(r.id),
    username: String(r.username),
    ok: Boolean(r.ok),
    at: String(r.at),
    ip: r.ip ? String(r.ip) : null,
    userAgent: r.user_agent ? String(r.user_agent) : null,
    note: r.note ? String(r.note) : null,
  }));
}

export function countLoginEvents(): number {
  const row = conn().prepare('SELECT COUNT(*) AS n FROM login_events').get() as any;
  return Number(row.n);
}
