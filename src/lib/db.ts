import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CATEGORIES, type CategoryDef } from './scoring-config';

/**
 * Local scoring database. The Airtable token is read-only for now, so every
 * value the dashboard lets you edit lives here instead. Swapping this file for
 * Airtable writes later means reimplementing `readScoring` / the two setters.
 */
const DB_PATH = resolve(process.env.SCOUTING_DB ?? 'data/scouting.db');

let db: DatabaseSync | undefined;

function connect(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const conn = new DatabaseSync(DB_PATH);
  conn.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS category_settings (
      category TEXT PRIMARY KEY,
      weight   REAL NOT NULL DEFAULT 1,
      enabled  INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS option_points (
      category TEXT NOT NULL,
      option   TEXT NOT NULL,
      points   REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (category, option)
    );
  `);
  // Added after the first release; both describe how the form presents the
  // answer, so they are refreshed from the schema on every load.
  addColumn(conn, 'option_points', 'sort', 'REAL NOT NULL DEFAULT 1e9');
  addColumn(conn, 'option_points', 'offered', 'INTEGER NOT NULL DEFAULT 0');
  seed(conn);
  db = conn;
  return conn;
}

function addColumn(conn: DatabaseSync, table: string, column: string, decl: string) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c) => c.name === column)) {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

function seed(conn: DatabaseSync) {
  const cat = conn.prepare(
    'INSERT INTO category_settings (category, weight, enabled) VALUES (?, 1, 1) ON CONFLICT(category) DO NOTHING',
  );
  const opt = conn.prepare(
    'INSERT INTO option_points (category, option, points, sort) VALUES (?, ?, ?, ?) ON CONFLICT(category, option) DO NOTHING',
  );
  for (const c of CATEGORIES) {
    cat.run(c.name);
    c.options.forEach((o, i) => opt.run(c.name, o.value, o.points, i));
  }
}

/**
 * Register answers that exist in the live data but not in our defaults, so a
 * new form option can never silently score as "nothing" without appearing in
 * the scoring editor.
 */
export function ensureOptions(seen: Map<string, Set<string>>) {
  const conn = connect();
  const stmt = conn.prepare(
    'INSERT INTO option_points (category, option, points) VALUES (?, ?, 0) ON CONFLICT(category, option) DO NOTHING',
  );
  for (const [category, values] of seen) for (const v of values) stmt.run(category, v);
}

/**
 * Reconcile the stored options with the form's real answer lists.
 *
 * Airtable's single-select choices are the source of truth: answers it offers
 * are added (keeping any default we know a value for), and stored options the
 * form no longer offers are dropped - unless a past entry still uses one, in
 * which case removing it would silently change that entry's score.
 */
export function syncOptionsFromSchema(
  choices: Map<string, string[]>,
  stillInUse: Map<string, Set<string>>,
) {
  const conn = connect();
  const insert = conn.prepare(
    'INSERT INTO option_points (category, option, points, sort, offered) VALUES (?, ?, ?, ?, 1) ON CONFLICT(category, option) DO UPDATE SET sort = excluded.sort, offered = 1',
  );
  const unoffer = conn.prepare(
    'UPDATE option_points SET offered = 0, sort = 1e6 WHERE category = ? AND option = ?',
  );
  const drop = conn.prepare('DELETE FROM option_points WHERE category = ? AND option = ?');

  for (const [category, offered] of choices) {
    const defaults = CATEGORIES.find((c) => c.name === category)?.options ?? [];
    offered.forEach((value, i) =>
      insert.run(category, value, defaults.find((o) => o.value === value)?.points ?? 0, i),
    );

    const keep = new Set(offered);
    const used = stillInUse.get(category) ?? new Set<string>();
    const stored = conn
      .prepare('SELECT option FROM option_points WHERE category = ?')
      .all(category) as any[];
    for (const row of stored) {
      if (keep.has(row.option)) continue;
      // An answer the form dropped but past entries still use has to keep its
      // points, or those entries would silently change score.
      if (used.has(row.option)) unoffer.run(category, row.option);
      else drop.run(category, row.option);
    }
  }
}

export interface ScoringOption {
  value: string;
  label: string;
  points: number;
  /** false when the option was discovered in the data rather than predefined. */
  known: boolean;
}

export interface ScoringCategory extends Pick<CategoryDef, 'name' | 'kind' | 'slot' | 'blurb'> {
  weight: number;
  enabled: boolean;
  options: ScoringOption[];
}

export function readScoring(): ScoringCategory[] {
  const conn = connect();
  const settings = new Map(
    (conn.prepare('SELECT category, weight, enabled FROM category_settings').all() as any[]).map(
      (r) => [r.category as string, r],
    ),
  );
  const points = conn
    .prepare('SELECT category, option, points, sort, offered FROM option_points ORDER BY sort, option')
    .all() as any[];

  return CATEGORIES.map((c) => {
    const row = settings.get(c.name);
    const rows = points.filter((p) => p.category === c.name);
    // Already ordered by the form's own choice order via `sort`.
    return {
      name: c.name,
      kind: c.kind,
      slot: c.slot,
      blurb: c.blurb,
      weight: row ? Number(row.weight) : 1,
      enabled: row ? Boolean(row.enabled) : true,
      options: rows.map((p) => {
        const preset = c.options.find((o) => o.value === p.option);
        return {
          value: p.option as string,
          label: preset?.label ?? (p.option as string),
          points: Number(p.points),
          // Drives the "new in data" flag: an answer the form still offers is
          // not new, whether or not we shipped a default for it.
          known: Boolean(preset) || Boolean(p.offered),
        };
      }),
    };
  });
}

export function setOptionPoints(category: string, option: string, points: number) {
  connect()
    .prepare(
      'INSERT INTO option_points (category, option, points) VALUES (?, ?, ?) ON CONFLICT(category, option) DO UPDATE SET points = excluded.points',
    )
    .run(category, option, points);
}

export function setCategorySettings(category: string, weight: number, enabled: boolean) {
  connect()
    .prepare(
      'INSERT INTO category_settings (category, weight, enabled) VALUES (?, ?, ?) ON CONFLICT(category) DO UPDATE SET weight = excluded.weight, enabled = excluded.enabled',
    )
    .run(category, weight, enabled ? 1 : 0);
}

export function resetScoring() {
  const conn = connect();
  conn.exec('DELETE FROM option_points; DELETE FROM category_settings;');
  seed(conn);
}
