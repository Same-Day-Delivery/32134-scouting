import { CATEGORIES, META_FIELDS } from './scoring-config';

const env = (key: string): string | undefined =>
  (import.meta.env as Record<string, any>)?.[key] ?? process.env[key];

export interface ScoutEntry {
  id: string;
  createdTime: string;
  team: string;
  alliance: string | null;
  notes: string | null;
  /** category -> chosen option, or null when the scout left it blank. */
  values: Record<string, string | null>;
}

export interface EntrySet {
  entries: ScoutEntry[];
  /** Records with no team name, which cannot be attributed to anyone. */
  unattributed: number;
  fetchedAt: string;
}

interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

async function fetchRecords(): Promise<AirtableRecord[]> {
  const token = env('AIRTABLE_ACCESS_TOKEN');
  const base = env('AIRTABLE_BASE_ID');
  const table = env('AIRTABLE_TABLE_NAME');
  if (!token || !base || !table) {
    throw new Error(
      'Missing Airtable config. Set AIRTABLE_ACCESS_TOKEN, AIRTABLE_BASE_ID and AIRTABLE_TABLE_NAME in .env',
    );
  }

  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable responded ${res.status}: ${body.slice(0, 300)}`);
    }
    const page = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    records.push(...page.records);
    offset = page.offset;
  } while (offset);

  return records;
}

function normalise(records: AirtableRecord[]): EntrySet {
  const entries: ScoutEntry[] = [];
  let unattributed = 0;

  for (const rec of records) {
    const team = String(rec.fields[META_FIELDS.team] ?? '').trim();
    if (!team) {
      unattributed++;
      continue;
    }

    const values: Record<string, string | null> = {};
    for (const cat of CATEGORIES) {
      const raw = rec.fields[cat.name];
      if (cat.kind === 'boolean') {
        // Airtable omits unchecked checkboxes entirely, so absent means false
        // rather than "not recorded".
        values[cat.name] = raw ? 'true' : 'false';
      } else {
        const v = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw);
        values[cat.name] = v === '' ? null : v;
      }
    }

    entries.push({
      id: rec.id,
      createdTime: rec.createdTime,
      team,
      alliance: (rec.fields[META_FIELDS.alliance] as string) ?? null,
      notes: (rec.fields[META_FIELDS.notes] as string) ?? null,
      values,
    });
  }

  entries.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  return { entries, unattributed, fetchedAt: new Date().toISOString() };
}

let cache: { data: EntrySet; at: number } | undefined;
const TTL_MS = 60_000;

export async function getEntries(force = false): Promise<EntrySet> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = normalise(await fetchRecords());
  cache = { data, at: Date.now() };
  return data;
}

/** Every distinct answer present in the live data, per category. */
export function observedOptions(entries: ScoutEntry[]): Map<string, Set<string>> {
  const seen = new Map<string, Set<string>>();
  for (const cat of CATEGORIES) seen.set(cat.name, new Set());
  for (const e of entries) {
    for (const [cat, v] of Object.entries(e.values)) {
      if (v != null) seen.get(cat)?.add(v);
    }
  }
  return seen;
}
