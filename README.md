# FTC Scouting Dashboard

Summarises the scouting-form responses in Airtable: ranks teams per category,
lets you set the point value of every answer, and ranks teams by total points.

## Running it

```sh
npm install
npm run dev        # http://localhost:4321
```

`.env` needs:

```
AIRTABLE_ACCESS_TOKEN=pat...
AIRTABLE_BASE_ID=app...
AIRTABLE_TABLE_NAME=Data         # scouting form responses, read
AIRTABLE_TABLE_NAME_2=Points     # calculated team stats, written

AUTH_USERNAME=scout              # seeds the first admin account
AUTH_PASSWORD=...                # seeds the first admin account
AUTH_SECRET=...                  # openssl rand -hex 32
```

The token needs `data.records:read`, `data.records:write`, `schema.bases:read`
and `schema.bases:write`.

## Signing in

Every page and API route needs an account. Signing in stores a cookie signed
with `AUTH_SECRET` that lasts a week; **Sign out** in the header clears it.

Accounts live in the database, not in `.env`. On a database with no accounts,
`AUTH_USERNAME` and `AUTH_PASSWORD` create the first **admin** at startup — the
account you then use to make the others. They are ignored once an account
exists, so changing that password later means using the admin page, not `.env`.
With no accounts and no `AUTH_PASSWORD`, nobody can sign in and the startup log
says so; it never falls open.

Change `AUTH_SECRET` and every existing session is invalidated, so everyone
signs in again — useful if a password leaks. Leave it unset and the server
generates a random one at startup, which means a restart logs everyone out.

## Accounts (`/admin`, admins only)

The **Accounts** button in the dashboard header — shown only to admins — opens
a page to:

- **Create a login.** Username, password, and whether they are an admin. Normal
  users get the dashboard; admins also get this page.
- **Set a new password.** Passwords are stored scrypt-hashed and cannot be read
  back, so a forgotten one is replaced, not recovered. Setting a password signs
  that person out of every device they are signed in on.
- **Change a role or delete an account.** Deleting signs them out immediately.

Three things the page will not let you do, because each locks someone out of
the page that would undo it: delete the account you are signed in as, remove
the last remaining admin, and remove your own admin access — another admin has
to do that one for you.

If you do end up locked out — `/admin` answering **Not found** means you are
signed in but no longer an admin — sign in as one of the other admins and
promote yourself back. To see who that is, or to fix it directly:

```sh
# who is an admin?
docker compose exec scouting node -e "const{DatabaseSync}=require('node:sqlite');\
  console.table(new DatabaseSync('/data/scouting.db')\
  .prepare('select id, username, is_admin from users').all())"

# put an account back to admin
docker compose exec scouting node -e "const{DatabaseSync}=require('node:sqlite');\
  new DatabaseSync('/data/scouting.db')\
  .prepare('update users set is_admin = 1 where username = ?').run('admin')"
```

### The sign-in log

The same page lists every sign-in attempt — who, when, from which IP, and on
what device — successful or not, alongside every account change made from the
admin page. A failed attempt records the username as typed, which is what makes
a run of guesses against a real account visible. Deleting an account leaves its
log entries in place.

Behind `tailscale serve` the client IP comes from `X-Forwarded-For`, which is
trustworthy here because compose binds the port to loopback, so nothing but
that proxy can reach it.

## Running behind a proxy

`tailscale serve` terminates TLS and forwards plain HTTP, but the Node adapter
decides a request's protocol from its own socket — so the container thinks the
site is HTTP while the browser knows it is HTTPS. Left alone that breaks two
things: Astro's `security.checkOrigin` compares the browser's `https://` Origin
against its own `http://` and refuses **every** form post with *"Cross-site POST
form submissions are forbidden"*, and session cookies lose their `Secure` flag.

So `security.checkOrigin` is off in `astro.config.mjs`, and `src/lib/origin.ts`
does the same job against `X-Forwarded-Proto` and `X-Forwarded-Host`: it
compares hosts rather than whole origins, so terminating TLS upstream is no
longer a mismatch, and cookies follow the browser's protocol rather than the
container's. Cross-site posts are still refused, and each refusal is logged with
the headers that caused it — check `docker compose logs` if one surprises you.

Trusting those headers is safe because compose binds the port to loopback. If
you ever publish the port directly, set `SITE_HOST` to the hostname people use
and it will be believed instead of any header.

## Tabs

| Tab | What it shows |
| --- | --- |
| **Leaderboard** | Teams ranked by total points. Each bar stacks the team's average points per category; negative categories (penalties, broken bot) extend left of zero. Click a team name to open it, or a legend entry to drop that category from the stack. |
| **Categories** | One ranked chart per category, plus how many entries recorded it. |
| **Scoring** | The point value of every answer, a per-category weight, and a toggle to leave a category out of the total. Edits re-rank everything immediately. |
| **Team** | One team's category averages and every individual form entry — answers, points, alliance, broken-bot flag and notes. |

## What happens when you open the site

Each page load runs the whole pipeline once — there is no polling or background
refresh:

1. Read the base schema, so the answer lists and column names come from
   Airtable rather than from assumptions in this repo.
2. Read every response from `Data`.
3. Recalculate each team's per-category averages and total.
4. Create or update one row per team in `Points`, matched on `Team Number`.

The result is reported above the stat tiles.

Columns are matched against the table case-insensitively, so the existing
`Teleop points` is used rather than a duplicate `Teleop Points` being made. Only
genuinely absent columns are created — `Rank`, `Total Points`, `Defense Points`,
`Entries` and `Last Synced` were added this way. A category no one recorded for
a team is written as empty rather than `0`, so the table keeps "no data"
distinct from "scored zero".

Adding a single-select answer to the form makes it appear in the Scoring tab at
0 points, in the order Airtable lists it. Removing one deletes it here too —
unless an existing entry still uses it, in which case its points are kept so
that entry's score does not silently change.

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
`data/scouting.db` (created on first run, git-ignored). The calculated results
go to Airtable; the scoring rules that produce them stay local. It uses Node's built-in `node:sqlite`, so there is
no database dependency to install.

To move the rules to Airtable too, reimplement `readScoring`, `setOptionPoints`
and `setCategorySettings` in [src/lib/db.ts](src/lib/db.ts) — nothing else reads
the database.

## Layout

```text
src/
├── lib/
│   ├── airtable.ts        fetch + normalise form responses
│   ├── airtable-schema.ts  read the base schema (answer lists, columns)
│   ├── load.ts            the read -> calculate -> write pipeline
│   ├── points-table.ts    write calculated stats back to Airtable
│   ├── compute.ts         ranking maths (shared with the browser)
│   ├── db.ts              local SQLite scoring store
│   ├── scoring-config.ts  categories and their default point values
│   ├── auth.ts            sessions, sign-in, first-admin seeding
│   ├── users.ts           accounts, password hashing, sign-in log
│   ├── origin.ts          proxy-aware origin check + HTTPS detection
│   └── request.ts         client IP and user agent, proxy-aware
├── middleware.ts          gates every route; /admin needs an admin
├── pages/
│   ├── api/entries.ts     GET  responses + scoring
│   ├── api/scoring.ts     GET/POST point values
│   ├── login.astro        the sign-in form
│   ├── logout.ts          POST clears the session
│   ├── admin.astro        accounts + the sign-in log
│   └── index.astro        the dashboard
├── scripts/dashboard.ts   charts, tabs, editing
└── styles/dashboard.css
```

New answers added to the form show up automatically: they appear in the Scoring
tab flagged **new in data**, starting at 0 points until you give them a value.
