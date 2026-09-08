# FTC Scouting Dashboard

Summarises the scouting-form responses in Airtable: ranks teams per category,
lets you set the point value of every answer, and ranks teams by total points.

## Running it

```sh
npm install
npm run dev        # http://localhost:4321
```

`.env` needs (the table name contains a space):

```
AIRTABLE_ACCESS_TOKEN=pat...
AIRTABLE_BASE_ID=app...
AIRTABLE_TABLE_NAME=Table 1
```

## Tabs

| Tab | What it shows |
| --- | --- |
| **Leaderboard** | Teams ranked by total points. Each bar stacks the team's average points per category; negative categories (penalties, broken bot) extend left of zero. Click a team name to open it, or a legend entry to drop that category from the stack. |
| **Categories** | One ranked chart per category, plus how many entries recorded it. |
| **Scoring** | The point value of every answer, a per-category weight, and a toggle to leave a category out of the total. Edits re-rank everything immediately. |
| **Team** | One team's category averages and every individual form entry — answers, points, alliance, broken-bot flag and notes. |

## How scores are calculated

A team's score in a category is the **mean over the entries that recorded that
category**. Entries where a scout left the field blank are skipped rather than
counted as zero, so a team is never dragged down by an unfilled form. The total
is the sum of those per-category averages, for the categories that are enabled.

Two consequences worth knowing:

- A category no one recorded for a team contributes nothing to that team's total.
- `Broken Bot` is a checkbox, and Airtable omits unchecked boxes entirely — so a
  missing value there means "not broken", not "not recorded".
- Rows with no team name cannot be attributed and are excluded from every
  ranking; the count is shown in the header tiles.

## Where the points are stored

Point values, weights and enable flags live in a local SQLite database at
`data/scouting.db` (created on first run, git-ignored), because the current
Airtable token is read-only. It uses Node's built-in `node:sqlite`, so there is
no database dependency to install.

To move this to Airtable later, reimplement `readScoring`, `setOptionPoints` and
`setCategorySettings` in [src/lib/db.ts](src/lib/db.ts) — nothing else reads the
database.

## Layout

```text
src/
├── lib/
│   ├── airtable.ts        fetch + normalise form responses
│   ├── compute.ts         ranking maths (shared with the browser)
│   ├── db.ts              local SQLite scoring store
│   └── scoring-config.ts  categories and their default point values
├── pages/
│   ├── api/entries.ts     GET  responses + scoring
│   ├── api/scoring.ts     GET/POST point values
│   └── index.astro        the dashboard
├── scripts/dashboard.ts   charts, tabs, editing
└── styles/dashboard.css
```

New answers added to the form show up automatically: they appear in the Scoring
tab flagged **new in data**, starting at 0 points until you give them a value.
