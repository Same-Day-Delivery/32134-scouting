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
  seed(conn);
  db = conn;
  return conn;
}

function seed(conn: DatabaseSync) {
  const cat = conn.prepare(
    'INSERT INTO category_settings (category, weight, enabled) VALUES (?, 1, 1) ON CONFLICT(category) DO NOTHING',
  );
  const opt = conn.prepare(
    'INSERT INTO option_points (category, option, points) VALUES (?, ?, ?) ON CONFLICT(category, option) DO NOTHING',
  );
  for (const c of CATEGORIES) {
    cat.run(c.name);
    for (const o of c.options) opt.run(c.name, o.value, o.points);
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
  const points = conn.prepare('SELECT category, option, points FROM option_points').all() as any[];

  return CATEGORIES.map((c) => {
    const row = settings.get(c.name);
    const rows = points.filter((p) => p.category === c.name);
    const order = c.options.map((o) => o.value);
    rows.sort((a, b) => {
      const ia = order.indexOf(a.option);
      const ib = order.indexOf(b.option);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.option.localeCompare(b.option);
    });
    return {
      name: c.name,
      kind: c.kind,
      slot: c.slot,
      blurb: c.blurb,
      weight: row ? Number(row.weight) : 1,
      enabled: row ? Boolean(row.enabled) : true,
      options: rows.map((p) => {
        const known = c.options.find((o) => o.value === p.option);
        return {
          value: p.option as string,
          label: known?.label ?? (p.option as string),
          points: Number(p.points),
          known: Boolean(known),
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
