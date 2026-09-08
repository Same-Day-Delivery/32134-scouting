/**
 * Ranking maths, shared by the browser bundle and the tests.
 *
 * The rule that matters: a team's score in a category is the mean over the
 * entries that actually recorded that category. Entries where a scout left the
 * field blank are skipped, not counted as zero, so a team with one unfilled
 * form is not dragged below a team whose scouts filled everything in.
 */

export interface Opt {
  value: string;
  label: string;
  points: number;
  known: boolean;
}

export interface Cat {
  name: string;
  kind: 'choice' | 'boolean';
  slot: number;
  blurb: string;
  weight: number;
  enabled: boolean;
  options: Opt[];
}

export interface Entry {
  id: string;
  createdTime: string;
  team: string;
  alliance: string | null;
  notes: string | null;
  values: Record<string, string | null>;
}

export interface CatStat {
  avg: number;
  recorded: number;
  missing: number;
}

export interface TeamStat {
  team: string;
  entries: number;
  total: number;
  cats: Record<string, CatStat>;
}

/** Weighted points for one answer, or null when it was never recorded. */
export function pointsFor(cat: Cat, value: string | null): number | null {
  if (value == null) return null;
  const opt = cat.options.find((o) => o.value === value);
  if (!opt) return null;
  return opt.points * cat.weight;
}

export function buildTeams(entries: Entry[], scoring: Cat[]): TeamStat[] {
  const byTeam = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byTeam.get(e.team);
    if (list) list.push(e);
    else byTeam.set(e.team, [e]);
  }

  const stats: TeamStat[] = [];
  for (const [team, list] of byTeam) {
    const cats: Record<string, CatStat> = {};
    let total = 0;
    for (const cat of scoring) {
      let sum = 0;
      let recorded = 0;
      for (const e of list) {
        const p = pointsFor(cat, e.values[cat.name]);
        if (p == null) continue;
        sum += p;
        recorded++;
      }
      const avg = recorded ? sum / recorded : 0;
      cats[cat.name] = { avg, recorded, missing: list.length - recorded };
      if (cat.enabled && recorded) total += avg;
    }
    stats.push({ team, entries: list.length, total, cats });
  }

  stats.sort((a, b) => b.total - a.total || a.team.localeCompare(b.team));
  return stats;
}
