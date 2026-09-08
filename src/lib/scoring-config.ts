/**
 * Category definitions for the FTC scouting form.
 *
 * `options` lists the answers we already know about, worst -> best, with the
 * point value each one starts at. Anything the form grows later shows up
 * automatically (see `ensureOptions` in db.ts) and starts at 0 points.
 */
export type CategoryKind = 'choice' | 'boolean';

export interface CategoryDef {
  /** Airtable field name. */
  name: string;
  kind: CategoryKind;
  /** Categorical palette slot (1-8), stable across every view. */
  slot: number;
  blurb: string;
  options: { value: string; label?: string; points: number }[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    name: 'Auto',
    kind: 'choice',
    slot: 1,
    blurb: 'What the robot managed during the autonomous period.',
    options: [
      { value: 'Doesnt move in Auto', points: 0 },
      { value: 'Moves in Auto', points: 5 },
      { value: 'Scores in Auto', points: 12 },
      { value: 'Scores Hella in Auto', points: 20 },
    ],
  },
  {
    name: 'Teleop',
    kind: 'choice',
    slot: 2,
    blurb: 'Driver-controlled scoring output.',
    options: [
      { value: 'Cant Score', points: 0 },
      { value: 'Scores some', points: 8 },
      { value: 'Scores moderately', points: 15 },
      { value: 'Scores hella', points: 25 },
    ],
  },
  {
    name: 'Endgame',
    kind: 'choice',
    slot: 3,
    blurb: 'Climb capability at the end of the match.',
    options: [
      { value: 'Cant climb', points: 0 },
      { value: 'Can Climb', points: 15 },
      { value: 'Can second stage climb', points: 25 },
    ],
  },
  {
    name: 'Penalties',
    kind: 'choice',
    slot: 4,
    blurb: 'Fouls given away. Negative values subtract from the total.',
    options: [
      { value: 'No fouls/penalties', points: 0 },
      { value: '1 foul/penalty', points: -3 },
      { value: 'some fouls/penalties', points: -8 },
      { value: 'a lot of fouls and penalties', points: -15 },
    ],
  },
  {
    name: 'Broken Bot',
    kind: 'boolean',
    slot: 5,
    blurb: 'Airtable omits unchecked boxes, so a missing value counts as "not broken".',
    options: [
      { value: 'false', label: 'Not broken', points: 0 },
      { value: 'true', label: 'Broken', points: -20 },
    ],
  },
];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

/** Fields carried through for context but never scored. */
export const META_FIELDS = { team: 'Team', alliance: 'Alliance', notes: 'Notes' } as const;

export function optionLabel(cat: CategoryDef, value: string): string {
  return cat.options.find((o) => o.value === value)?.label ?? value;
}
