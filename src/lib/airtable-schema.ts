/**
 * Base schema reader. With schema access we can take the real answer lists and
 * the real column names straight from Airtable, instead of guessing them.
 */
const env = (key: string): string | undefined =>
  (import.meta.env as Record<string, any>)?.[key] ?? process.env[key];

export interface SchemaField {
  id: string;
  name: string;
  type: string;
  options?: Record<string, any>;
}

export interface SchemaTable {
  id: string;
  name: string;
  fields: SchemaField[];
}

export interface BaseSchema {
  tables: SchemaTable[];
  /** null when the token cannot read the schema; callers must degrade. */
  available: boolean;
  error: string | null;
}

export async function getBaseSchema(): Promise<BaseSchema> {
  const token = env('AIRTABLE_ACCESS_TOKEN');
  const base = env('AIRTABLE_BASE_ID');
  if (!token || !base) return { tables: [], available: false, error: 'Airtable config missing' };

  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${base}/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    return {
      tables: [],
      available: false,
      error: `Schema read failed (${res.status}). Add schema.bases:read to the token. ${body.slice(0, 160)}`,
    };
  }
  const body = (await res.json()) as { tables: SchemaTable[] };
  return { tables: body.tables ?? [], available: true, error: null };
}

export function findTable(schema: BaseSchema, nameOrId: string): SchemaTable | undefined {
  return schema.tables.find((t) => t.name === nameOrId || t.id === nameOrId);
}

/** Case- and spacing-insensitive column lookup, so "Teleop points" matches "Teleop Points". */
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function findField(table: SchemaTable, ...candidates: string[]): SchemaField | undefined {
  for (const candidate of candidates) {
    const want = normalise(candidate);
    const hit = table.fields.find((f) => normalise(f.name) === want);
    if (hit) return hit;
  }
  return undefined;
}

/** The choice list of a singleSelect field, in the order Airtable shows it. */
export function choicesOf(field: SchemaField | undefined): string[] {
  return (field?.options?.choices ?? []).map((c: any) => c.name as string);
}
