import { getEntries, observedOptions, type EntrySet } from './airtable';
import { choicesOf, findField, findTable, getBaseSchema } from './airtable-schema';
import { buildTeams } from './compute';
import { ensureOptions, readScoring, syncOptionsFromSchema, type ScoringCategory } from './db';
import { syncPoints, type SyncResult } from './points-table';
import { CATEGORIES } from './scoring-config';

const env = (key: string): string | undefined =>
  (import.meta.env as Record<string, any>)?.[key] ?? process.env[key];

export interface DashboardData extends EntrySet {
  scoring: ScoringCategory[];
  sync: SyncResult;
  schemaWarning: string | null;
}

/**
 * The whole pipeline, run once per page open: read the responses, reconcile the
 * answer lists with the form, recalculate every team, write the results back to
 * the Points table.
 */
export async function loadDashboard(): Promise<DashboardData> {
  const [schema, data] = await Promise.all([getBaseSchema(), getEntries()]);

  const inUse = observedOptions(data.entries);
  const order = new Map<string, string[]>();

  if (schema.available) {
    const responses = findTable(schema, env('AIRTABLE_TABLE_NAME') ?? 'Data');
    if (responses) {
      for (const cat of CATEGORIES) {
        if (cat.kind !== 'choice') continue;
        const choices = choicesOf(findField(responses, cat.name));
        if (choices.length) order.set(cat.name, choices);
      }
      syncOptionsFromSchema(order, inUse);
    }
  }
  // Anything a scout recorded that the form no longer offers still needs a
  // point value, so register those too.
  ensureOptions(inUse);

  const scoring = readScoring();
  const sync = await syncPoints(buildTeams(data.entries, scoring), scoring, schema);

  return { ...data, scoring, sync, schemaWarning: schema.available ? null : schema.error };
}
