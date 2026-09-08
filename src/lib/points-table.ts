/**
 * Writes the calculated per-team stats back to the Airtable "Points" table.
 *
 * The table already has columns with the team's own naming ("Team Number",
 * "Teleop points"), so columns are matched against the live schema rather than
 * assumed, and only genuinely absent ones are created.
 */
import { CATEGORIES } from './scoring-config';
import type { Cat, TeamStat } from './compute';
import { findField, findTable, type BaseSchema, type SchemaTable } from './airtable-schema';

const env = (key: string): string | undefined =>
  (import.meta.env as Record<string, any>)?.[key] ?? process.env[key];

const TEAM = { name: 'Team Number', type: 'singleLineText', aliases: ['Team', 'Team #'] };
const RANK = { name: 'Rank', type: 'number', precision: 0 };
const TOTAL = { name: 'Total Points', type: 'number', precision: 1, aliases: ['Total'] };
const ENTRIES = { name: 'Entries', type: 'number', precision: 0, aliases: ['Entry Count'] };
const SYNCED = { name: 'Last Synced', type: 'dateTime', aliases: ['Last Updated'] };

export interface SyncResult {
  ok: boolean;
  created: number;
  updated: number;
  columnsCreated: string[];
  syncedAt: string | null;
  error: string | null;
}

const round = (n: number) => Math.round(n * 10) / 10;

function auth() {
  const token = env('AIRTABLE_ACCESS_TOKEN');
  const base = env('AIRTABLE_BASE_ID');
  const table = env('AIRTABLE_TABLE_NAME_2') ?? 'Points';
  if (!token || !base) throw new Error('AIRTABLE_ACCESS_TOKEN and AIRTABLE_BASE_ID must be set');
  return { token, base, table };
}

async function call(url: string, init: RequestInit, token: string) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: body as any };
}

interface Column {
  /** The column name to write to - the existing one where there is one. */
  field: string;
  created: boolean;
}

/** Find each column we need, creating the ones the table does not have yet. */
async function resolveColumns(
  table: SchemaTable,
  scoring: Cat[],
): Promise<{ team: string; rank: string; total: string; entries: string; synced: string; cats: Map<string, string>; created: string[] }> {
  const { token, base } = auth();
  const created: string[] = [];

  const resolve = async (
    spec: { name: string; type: string; precision?: number; aliases?: string[] },
    description: string,
  ): Promise<Column> => {
    const existing = findField(table, spec.name, ...(spec.aliases ?? []));
    if (existing) return { field: existing.name, created: false };

    const body: Record<string, unknown> = { name: spec.name, type: spec.type, description };
    if (spec.type === 'number') body.options = { precision: spec.precision ?? 1 };
    if (spec.type === 'dateTime') {
      body.options = { timeZone: 'utc', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } };
    }

    const res = await call(
      `https://api.airtable.com/v0/meta/bases/${base}/tables/${table.id}/fields`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    );
    if (!res.ok) {
      throw new Error(
        `Could not create the "${spec.name}" column: ${res.body?.error?.message ?? res.status}`,
      );
    }
    created.push(spec.name);
    return { field: spec.name, created: true };
  };

  const team = await resolve(TEAM, 'Team number, used to match rows to the scouting form');
  const rank = await resolve(RANK, 'Leaderboard position, 1 = best');
  const total = await resolve(TOTAL, 'Sum of the per-category averages');
  const cats = new Map<string, string>();
  for (const cat of scoring) {
    const def = CATEGORIES.find((c) => c.name === cat.name);
    const col = await resolve(
      { name: def?.pointsField ?? `${cat.name} Points`, type: 'number', precision: 1, aliases: [cat.name] },
      `Average ${cat.name} points across the entries that recorded it`,
    );
    cats.set(cat.name, col.field);
  }
  const entries = await resolve(ENTRIES, 'Scouting form entries for this team');
  const synced = await resolve(SYNCED, 'When the dashboard last wrote these numbers');

  return { team: team.field, rank: rank.field, total: total.field, entries: entries.field, synced: synced.field, cats, created };
}

/** Create-or-update one row per team, matched on the team column. */
export async function syncPoints(
  teams: TeamStat[],
  scoring: Cat[],
  schema: BaseSchema,
): Promise<SyncResult> {
  const syncedAt = new Date().toISOString();
  const result: SyncResult = {
    ok: false, created: 0, updated: 0, columnsCreated: [], syncedAt: null, error: null,
  };

  try {
    const { token, base, table: tableName } = auth();

    if (!schema.available) {
      throw new Error(schema.error ?? 'Cannot read the base schema, so the Points columns cannot be matched');
    }
    const table = findTable(schema, tableName);
    if (!table) throw new Error(`No table named "${tableName}" in this base`);

    const cols = await resolveColumns(table, scoring);
    result.columnsCreated = cols.created;

    const records = teams.map((team, i) => {
      const fields: Record<string, unknown> = {
        [cols.team]: team.team,
        [cols.rank]: i + 1,
        [cols.total]: round(team.total),
        [cols.entries]: team.entries,
        [cols.synced]: syncedAt,
      };
      for (const cat of scoring) {
        const stat = team.cats[cat.name];
        // A category nobody recorded for this team is left empty rather than 0,
        // so the table keeps "no data" distinct from "scored zero".
        fields[cols.cats.get(cat.name)!] = stat && stat.recorded ? round(stat.avg) : null;
      }
      return { fields };
    });

    // Airtable takes at most 10 records per upsert request.
    for (let i = 0; i < records.length; i += 10) {
      const res = await call(
        `https://api.airtable.com/v0/${base}/${encodeURIComponent(tableName)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            performUpsert: { fieldsToMergeOn: [cols.team] },
            records: records.slice(i, i + 10),
            typecast: true,
          }),
        },
        token,
      );
      if (!res.ok) throw new Error(res.body?.error?.message ?? `Airtable responded ${res.status}`);
      result.created += (res.body.createdRecords ?? []).length;
      result.updated += (res.body.updatedRecords ?? []).length;
    }

    result.ok = true;
    result.syncedAt = syncedAt;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}
