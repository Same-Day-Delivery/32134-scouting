import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  type User,
  authenticate,
  countAdmins,
  createUser,
  getUser,
  listUsers,
  markLoggedIn,
  usernameTaken,
} from './users';

export const SESSION_COOKIE = 'scouting_session';

// A week: long enough that scouts at a competition are not re-typing the
// password between matches, short enough that a forgotten phone expires.
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

// `astro dev` exposes .env through import.meta.env, but reading it that way
// would bake the password into dist/ at build time and freeze it there. Read
// process.env instead — compose passes .env in through env_file — and load the
// file ourselves when it is only on disk, as it is during local development.
if (!process.env.AUTH_PASSWORD) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env on disk: the environment is expected to carry the values.
  }
}

const env = (key: string) => {
  const raw = process.env[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

// Without a fixed secret every restart invalidates the cookies it signed, so
// a deployment that cares about staying logged in sets AUTH_SECRET itself.
const SECRET = env('AUTH_SECRET') ?? randomBytes(32).toString('hex');

if (!env('AUTH_SECRET')) {
  console.warn(
    '[auth] AUTH_SECRET is not set — a random one was generated, so restarting logs everyone out.',
  );
}

/**
 * Accounts live in the database, but an empty database has nobody to log in
 * with. AUTH_USERNAME / AUTH_PASSWORD seed the first admin and are ignored
 * from then on, so changing that password later means using the admin page.
 */
let seeded = false;
export function ensureSeedAdmin() {
  if (seeded) return;
  seeded = true;

  if (listUsers().length > 0) return;

  const username = env('AUTH_USERNAME') ?? 'admin';
  const password = env('AUTH_PASSWORD');
  if (!password) {
    console.warn(
      '[auth] No accounts exist and AUTH_PASSWORD is not set — nobody can sign in. ' +
        'Set AUTH_USERNAME and AUTH_PASSWORD in .env and restart to create the first admin.',
    );
    return;
  }
  if (usernameTaken(username)) return;
  createUser(username, password, true);
  console.log(`[auth] Created the first admin account "${username}" from .env.`);
}

/* ---------------------------------------------------------------- sessions */

const sign = (payload: string) => createHmac('sha256', SECRET).update(payload).digest('base64url');

const constantTimeEqual = (a: string, b: string) => {
  // timingSafeEqual throws on a length mismatch, so hash first: the digests
  // are always the same length and differ whenever the inputs do.
  const digest = (v: string) => createHmac('sha256', SECRET).update(v).digest();
  return timingSafeEqual(digest(a), digest(b));
};

/**
 * A token is `<userId>.<tokenVersion>.<expiry>.<signature>`. The signature is
 * what makes it unforgeable; the version is what lets a password change cut
 * every session that user already had.
 */
export function createSessionToken(user: User): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${user.id}.${user.tokenVersion}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/** The signed-in user for a cookie value, or null if it is missing or stale. */
export function resolveSession(token: string | undefined): User | null {
  if (!token) return null;

  const cut = token.lastIndexOf('.');
  if (cut < 1) return null;
  const payload = token.slice(0, cut);
  if (!constantTimeEqual(token.slice(cut + 1), sign(payload))) return null;

  const [idRaw, versionRaw, expiryRaw] = payload.split('.');
  const expiresAt = Number(expiryRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const user = getUser(Number(idRaw));
  // A deleted account, or one whose password changed, fails here even though
  // the signature is still good.
  if (!user || user.tokenVersion !== Number(versionRaw)) return null;
  return user;
}

/** Secure is conditional: the tailnet serves HTTPS, but `astro dev` is plain HTTP. */
export const sessionCookieOptions = (url: URL) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: url.protocol === 'https:',
  path: '/',
  maxAge: SESSION_MAX_AGE,
});

/* ------------------------------------------------------------------- login */

/** Verifies a username/password pair and stamps the user's last-login time. */
export function signIn(username: string, password: string): User | null {
  ensureSeedAdmin();
  const user = authenticate(username, password);
  if (user) markLoggedIn(user.id);
  return user;
}

export { countAdmins };
