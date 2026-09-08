/* Client-side dashboard. All ranking maths runs here so that editing a point
   value re-ranks instantly; the value itself is persisted to the local DB. */

import { buildTeams, pointsFor, type Cat, type Entry, type TeamStat } from '../lib/compute';

interface Boot { entries: Entry[]; unattributed: number; fetchedAt: string; scoring: Cat[] }

const boot: Boot = JSON.parse(document.getElementById('bootstrap')!.textContent!);
let entries = boot.entries;
let scoring = boot.scoring;
let unattributed = boot.unattributed;
let fetchedAt = boot.fetchedAt;
let selectedTeam: string | null = null;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const color = (slot: number) => `var(--s${slot})`;

const fmt = (n: number, dp = 1) => {
  const s = n.toFixed(dp);
  return s.replace(/\.0+$/, '');
};
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> = {},
  ...kids: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}

/* ------------------------------------------------------------------ charts */

interface Seg { label: string; value: number; color: string }
interface Row { key: string; name: string; value: number; segs: Seg[]; note?: string }

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step / 1e6; t += step) {
    ticks.push(Math.abs(t) < 1e-9 ? 0 : t);
  }
  return ticks;
}

/** Horizontal bars on a shared zero baseline; segments stack outward from zero. */
function renderChart(
  rows: Row[],
  opts: { onPick?: (key: string) => void; valueSuffix?: string; compact?: boolean; showRank?: boolean } = {},
) {
  if (!rows.length) return el('p', { class: 'empty', text: 'No scored entries yet.' });

  let domainMax = 0;
  let domainMin = 0;
  for (const r of rows) {
    let pos = 0;
    let neg = 0;
    for (const s of r.segs) (s.value >= 0 ? (pos += s.value) : (neg += s.value));
    domainMax = Math.max(domainMax, pos);
    domainMin = Math.min(domainMin, neg);
  }
  if (domainMax === 0 && domainMin === 0) domainMax = 1;
  const span = domainMax - domainMin;
  const pct = (v: number) => (v / span) * 100;
  const zeroPct = pct(-domainMin);

  const showRank = opts.showRank !== false;
  const chart = el('div', { class: `chart${opts.compact ? ' compact' : ''}${showRank ? '' : ' norank'}` });

  rows.forEach((r, i) => {
    const track = el('div', { class: 'track' });
    track.append(el('div', { class: 'zero', style: `left:${zeroPct}%` }));

    const pos = r.segs.filter((s) => s.value > 0);
    const neg = r.segs.filter((s) => s.value < 0);

    let cum = 0;
    pos.forEach((s, j) => {
      const seg = el('div', {
        class: `seg${j === pos.length - 1 ? (pos.length === 1 && !neg.length ? ' solo' : ' end-r') : ''}`,
        style: `left:${zeroPct + pct(cum)}%; width:${pct(s.value)}%`,
      });
      seg.append(el('div', { class: 'seg-inner', style: `background:${s.color}` }));
      track.append(seg);
      cum += s.value;
    });

    cum = 0;
    neg.forEach((s, j) => {
      cum += s.value;
      const seg = el('div', {
        class: `seg${j === neg.length - 1 ? (neg.length === 1 && !pos.length ? ' solo' : ' end-l') : ''}`,
        style: `left:${zeroPct + pct(cum)}%; width:${pct(-s.value)}%`,
      });
      seg.append(el('div', { class: 'seg-inner', style: `background:${s.color}` }));
      track.append(seg);
    });

    track.addEventListener('pointerenter', () => showTip(r, opts.valueSuffix));
    track.addEventListener('pointermove', moveTip);
    track.addEventListener('pointerleave', hideTip);

    const name = opts.onPick
      ? el('button', {
          type: 'button',
          class: 'row-name link',
          title: `Open ${r.name}`,
          text: r.name,
          onclick: () => opts.onPick!(r.key),
        })
      : el('div', { class: 'row-name', title: r.name, text: r.name });

    chart.append(
      el(
        'div',
        { class: 'row' },
        showRank ? el('div', { class: 'rank', text: String(i + 1) }) : null,
        name,
        track,
        el('div', { class: 'row-value', text: fmt(r.value) }),
      ),
    );
  });

  const ticks = niceTicks(domainMin, domainMax, opts.compact ? 3 : 5);
  const scale = el('div', { class: 'scale' });
  const inner = el('div', { class: 'scale-inner' });
  inner.append(el('div', { class: 'axis-line', style: 'grid-column:auto' }));
  for (const t of ticks) {
    const at = pct(t - domainMin);
    // Pin the outermost labels inside the plot so they cannot overhang the card.
    const shift = at <= 0.5 ? 'translateX(0)' : at >= 99.5 ? 'translateX(-100%)' : 'translateX(-50%)';
    inner.append(
      el('div', { class: 'tick', style: `left:${at}%; transform:${shift}`, text: fmt(t, 0) }),
    );
  }
  scale.append(inner);
  chart.append(scale);
  pruneTicks(inner);
  return chart;
}

/** Drop tick labels that would collide once the chart has an actual width. */
function pruneTicks(inner: HTMLElement) {
  requestAnimationFrame(() => {
    const labels = [...inner.querySelectorAll<HTMLElement>('.tick')];
    let lastRight = -Infinity;
    for (const label of labels) {
      label.style.visibility = 'visible';
      const box = label.getBoundingClientRect();
      if (box.width === 0) continue;
      if (box.left < lastRight + 8) label.style.visibility = 'hidden';
      else lastRight = box.right;
    }
  });
}

/* ------------------------------------------------------------------ tooltip */

const tip = $('#tip');

function showTip(r: Row, suffix = 'pts') {
  tip.replaceChildren();
  tip.append(el('div', { class: 'tip-title', text: r.name }));
  if (r.segs.length > 1) {
    const dl = el('dl');
    for (const s of r.segs) {
      dl.append(
        el('dt', {}, el('span', { class: 'swatch', style: `background:${s.color}` })),
        el('dd', { style: 'text-align:left', text: s.label }),
        el('dd', { text: signed(s.value) }),
      );
    }
    tip.append(dl);
    tip.append(
      el(
        'div',
        { class: 'tip-total' },
        el('span', { text: 'Total' }),
        el('span', { text: `${fmt(r.value)} ${suffix}` }),
      ),
    );
  } else {
    tip.append(el('div', { class: 'tip-total' }, el('span', { text: 'Average' }), el('span', { text: `${fmt(r.value)} ${suffix}` })));
  }
  if (r.note) tip.append(el('div', { style: 'margin-top:6px;color:var(--muted)', text: r.note }));
  tip.classList.add('on');
}
function moveTip(ev: PointerEvent) {
  const pad = 14;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function hideTip() {
  tip.classList.remove('on');
}

/* ------------------------------------------------------------------ views */

let hidden = new Set<string>();

function renderTiles(teams: TeamStat[]) {
  const scored = entries.length;
  const enabled = scoring.filter((c) => c.enabled);
  const top = teams[0];
  const blanks = scoring.reduce(
    (n, c) => n + entries.filter((e) => e.values[c.name] == null).length,
    0,
  );

  const tiles: [string, string, string?, boolean?][] = [
    ['Teams scouted', String(teams.length), `${scored} form ${scored === 1 ? 'entry' : 'entries'}`],
    [
      'Top team',
      top ? top.team : '—',
      top ? `${fmt(top.total)} pts average` : 'no data',
    ],
    [
      'Categories counted',
      `${enabled.length}/${scoring.length}`,
      enabled.length === scoring.length ? 'all in the total' : 'some excluded',
    ],
    [
      'Unrecorded answers',
      String(blanks),
      blanks ? 'skipped, not counted as zero' : 'every field filled in',
      blanks > 0,
    ],
    [
      'Rows without a team',
      String(unattributed),
      unattributed ? 'excluded from every ranking' : 'none',
      unattributed > 0,
    ],
  ];

  const wrap = $('#tiles');
  wrap.replaceChildren(
    ...tiles.map(([label, value, note, warn]) =>
      el(
        'div',
        { class: 'tile' },
        el('div', { class: 'tile-label', text: label }),
        el('div', { class: 'tile-value', text: value }),
        note ? el('div', { class: `tile-note${warn ? ' warn' : ''}`, text: note }) : null,
      ),
    ),
  );
}

function legend(cats: Cat[]) {
  const ul = el('ul', { class: 'legend' });
  for (const c of cats) {
    const on = !hidden.has(c.name);
    ul.append(
      el(
        'li',
        {},
        el(
          'button',
          {
            'aria-pressed': String(on),
            title: on ? `Hide ${c.name} from the stack` : `Show ${c.name}`,
            onclick: () => {
              hidden.has(c.name) ? hidden.delete(c.name) : hidden.add(c.name);
              renderAll();
            },
          },
          el('span', { class: 'swatch', style: `background:${color(c.slot)}` }),
          el('span', { text: `${c.name}${c.weight !== 1 ? ` ×${fmt(c.weight, 2)}` : ''}` }),
        ),
      ),
    );
  }
  return ul;
}

function renderLeaderboard(teams: TeamStat[]) {
  const cats = scoring.filter((c) => c.enabled);
  const shown = cats.filter((c) => !hidden.has(c.name));

  const rows: Row[] = teams.map((t) => ({
    key: t.team,
    name: t.team,
    value: shown.reduce((n, c) => n + (t.cats[c.name].recorded ? t.cats[c.name].avg : 0), 0),
    segs: shown
      .filter((c) => t.cats[c.name].recorded && t.cats[c.name].avg !== 0)
      .map((c) => ({ label: c.name, value: t.cats[c.name].avg, color: color(c.slot) })),
    note: `${t.entries} ${t.entries === 1 ? 'entry' : 'entries'}`,
  }));
  rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  const host = $('#leaderboard');
  host.replaceChildren(
    legend(cats),
    renderChart(rows, { onPick: openTeam }),
    tableView(
      ['Rank', 'Team', ...cats.map((c) => c.name), 'Total', 'Entries'],
      rows.map((r, i) => {
        const t = teams.find((x) => x.team === r.key)!;
        return [
          String(i + 1),
          t.team,
          ...cats.map((c) => (t.cats[c.name].recorded ? fmt(t.cats[c.name].avg) : '—')),
          fmt(r.value),
          String(t.entries),
        ];
      }),
    ),
  );
}

function renderCategories(teams: TeamStat[]) {
  const host = $('#facets');
  host.replaceChildren(
    ...scoring.map((cat) => {
      const ranked = teams
        .filter((t) => t.cats[cat.name].recorded > 0)
        .map((t) => ({
          key: t.team,
          name: t.team,
          value: t.cats[cat.name].avg,
          segs: [{ label: cat.name, value: t.cats[cat.name].avg, color: color(cat.slot) }],
          note: `recorded in ${t.cats[cat.name].recorded} of ${t.entries} ${
            t.entries === 1 ? 'entry' : 'entries'
          }`,
        }))
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

      const coverage = entries.filter((e) => e.values[cat.name] != null).length;

      return el(
        'section',
        { class: `card${cat.enabled ? '' : ' off'}` },
        el(
          'div',
          { class: 'card-head' },
          el(
            'h3',
            { class: 'card-title' },
            el('span', { class: 'swatch', style: `background:${color(cat.slot)};display:inline-block;margin-right:8px` }),
            document.createTextNode(cat.name),
          ),
          el('span', {
            class: 'card-sub',
            style: 'margin:0',
            text: cat.enabled ? `${coverage}/${entries.length} recorded` : 'excluded from total',
          }),
        ),
        el('p', { class: 'card-sub', text: cat.blurb }),
        renderChart(ranked, { onPick: openTeam, compact: true }),
      );
    }),
  );
}

function tableView(head: string[], rows: string[][]) {
  const table = el('table');
  table.append(
    el('thead', {}, el('tr', {}, ...head.map((h, i) => el('th', { class: i === 1 ? 'txt' : '', text: h })))),
  );
  table.append(
    el(
      'tbody',
      {},
      ...rows.map((r) => el('tr', {}, ...r.map((c, i) => el('td', { class: i === 1 ? 'txt' : '', text: c })))),
    ),
  );
  return el(
    'details',
    { class: 'table-view' },
    el('summary', { text: 'Table view' }),
    el('div', { class: 'scroll-x' }, table),
  );
}

/* ------------------------------------------------------------------ scoring editor */

let saveTimer: number | undefined;
const pending = { options: new Map<string, any>(), categories: new Map<string, any>() };

function queueSave(kind: 'options' | 'categories', key: string, payload: any) {
  pending[kind].set(key, payload);
  const state = $('#save-state');
  state.className = 'save-state';
  state.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 400);
}

async function flushSave() {
  const body = {
    options: [...pending.options.values()],
    categories: [...pending.categories.values()],
  };
  pending.options.clear();
  pending.categories.clear();
  const state = $('#save-state');
  try {
    const res = await fetch('/api/scoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    state.className = 'save-state';
    state.textContent = 'Saved';
    setTimeout(() => (state.textContent === 'Saved' ? (state.textContent = '') : null), 1800);
  } catch (err) {
    state.className = 'save-state err';
    state.textContent = 'Save failed';
    console.error(err);
  }
}

function renderScoring() {
  const host = $('#scoring');
  host.replaceChildren(
    ...scoring.map((cat) => {
      const card = el('section', { class: `card${cat.enabled ? '' : ' off'}` });
      card.append(
        el(
          'div',
          { class: 'card-head' },
          el(
            'h3',
            { class: 'card-title' },
            el('span', {
              class: 'swatch',
              style: `background:${color(cat.slot)};display:inline-block;margin-right:8px`,
            }),
            document.createTextNode(cat.name),
          ),
        ),
        el('p', { class: 'card-sub', text: cat.blurb }),
        el(
          'div',
          { class: 'cat-controls' },
          el(
            'label',
            {},
            el('input', {
              type: 'checkbox',
              checked: cat.enabled,
              onchange: (ev: Event) => {
                cat.enabled = (ev.target as HTMLInputElement).checked;
                queueSave('categories', cat.name, {
                  category: cat.name,
                  weight: cat.weight,
                  enabled: cat.enabled,
                });
                renderAll();
              },
            }),
            el('span', { text: 'Count in total' }),
          ),
          el(
            'label',
            {},
            el('span', { text: 'Weight' }),
            el('input', {
              type: 'number',
              step: '0.1',
              value: String(cat.weight),
              oninput: (ev: Event) => {
                const v = Number((ev.target as HTMLInputElement).value);
                if (!Number.isFinite(v)) return;
                cat.weight = v;
                queueSave('categories', cat.name, {
                  category: cat.name,
                  weight: v,
                  enabled: cat.enabled,
                });
                renderAll({ keepScoring: true });
              },
            }),
          ),
        ),
      );

      for (const opt of cat.options) {
        card.append(
          el(
            'div',
            { class: 'opt-row' },
            el(
              'div',
              { class: 'opt-name' },
              document.createTextNode(opt.label),
              !opt.known ? el('span', { class: 'opt-new', text: 'new in data' }) : null,
            ),
            el('input', {
              type: 'number',
              step: '1',
              value: String(opt.points),
              'aria-label': `${cat.name} — ${opt.label} points`,
              oninput: (ev: Event) => {
                const v = Number((ev.target as HTMLInputElement).value);
                if (!Number.isFinite(v)) return;
                opt.points = v;
                queueSave('options', `${cat.name}::${opt.value}`, {
                  category: cat.name,
                  option: opt.value,
                  points: v,
                });
                renderAll({ keepScoring: true });
              },
            }),
          ),
        );
      }
      return card;
    }),
  );
}

/* ------------------------------------------------------------------ team explorer */

function openTeam(team: string) {
  selectedTeam = team;
  showTab('team');
  renderTeam();
  const sel = $<HTMLSelectElement>('#team-select');
  sel.value = team;
}

function renderTeamPicker(teams: TeamStat[]) {
  const sel = $<HTMLSelectElement>('#team-select');
  if (!teams.some((t) => t.team === selectedTeam)) selectedTeam = teams[0]?.team ?? null;
  sel.replaceChildren(
    ...teams
      .slice()
      .sort((a, b) => a.team.localeCompare(b.team, undefined, { numeric: true }))
      .map((t) => el('option', { value: t.team, text: `${t.team} — ${t.entries} ${t.entries === 1 ? 'entry' : 'entries'}` })),
  );
  if (selectedTeam) sel.value = selectedTeam;
}

function renderTeam() {
  const host = $('#team-detail');
  const teams = buildTeams(entries, scoring);
  const stat = teams.find((t) => t.team === selectedTeam);
  if (!stat) {
    host.replaceChildren(el('p', { class: 'empty', text: 'No team selected.' }));
    return;
  }
  const rank = teams.indexOf(stat) + 1;
  const list = entries.filter((e) => e.team === stat.team);
  const enabled = scoring.filter((c) => c.enabled);

  const summary = el(
    'section',
    { class: 'card' },
    el(
      'div',
      { class: 'card-head' },
      el('h2', { class: 'card-title', style: 'font-size:18px', text: stat.team }),
      el('span', {
        class: 'card-sub',
        style: 'margin:0',
        text: `Rank ${rank} of ${teams.length} · ${fmt(stat.total)} pts average · ${list.length} ${
          list.length === 1 ? 'entry' : 'entries'
        }`,
      }),
    ),
    el('p', { class: 'card-sub', text: 'Average points per category across every entry that recorded it.' }),
    legend(enabled),
    renderChart(
      enabled.map((c) => ({
        key: c.name,
        name: c.name,
        value: stat.cats[c.name].avg,
        segs: [{ label: c.name, value: stat.cats[c.name].avg, color: color(c.slot) }],
        note: `${stat.cats[c.name].recorded} of ${list.length} recorded${
          stat.cats[c.name].missing ? ` · ${stat.cats[c.name].missing} blank` : ''
        }`,
      })),
      { showRank: false },
    ),
    tableView(
      ['Category', 'Average', 'Recorded', 'Blank', 'Weight'],
      enabled.map((c) => [
        c.name,
        stat.cats[c.name].recorded ? fmt(stat.cats[c.name].avg) : '—',
        String(stat.cats[c.name].recorded),
        String(stat.cats[c.name].missing),
        fmt(c.weight, 2),
      ]),
    ),
  );

  const entryCards = list.map((e) => {
    const total = scoring
      .filter((c) => c.enabled)
      .reduce((n, c) => n + (pointsFor(c, e.values[c.name]) ?? 0), 0);
    return el(
      'article',
      { class: 'entry' },
      el(
        'div',
        { class: 'entry-head' },
        el('strong', { text: `${fmt(total)} pts` }),
        el('span', {
          class: 'entry-when',
          text: new Date(e.createdTime).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        }),
        e.alliance
          ? el('span', { class: `pill ${e.alliance.toLowerCase() === 'red' ? 'red' : 'blue'}`, text: `${e.alliance} alliance` })
          : null,
        e.values['Broken Bot'] === 'true' ? el('span', { class: 'pill broken', text: 'Broken bot' }) : null,
      ),
      el(
        'div',
        { class: 'answers' },
        ...scoring
          .filter((c) => c.kind !== 'boolean')
          .map((c) => {
            const v = e.values[c.name];
            const opt = c.options.find((o) => o.value === v);
            const pts = pointsFor(c, v);
            return el(
              'div',
              { class: 'answer', style: `--cat:${color(c.slot)}` },
              el('div', { class: 'answer-cat', text: c.name }),
              el('div', {
                class: `answer-val${v == null ? ' none' : ''}`,
                text: v == null ? 'not recorded' : opt?.label ?? v,
              }),
              el('div', {
                class: 'answer-pts',
                text: pts == null ? '—' : `${signed(pts)} pts`,
              }),
            );
          }),
      ),
      e.notes ? el('div', { class: 'notes' }, el('strong', { text: 'Notes: ' }), document.createTextNode(e.notes)) : null,
    );
  });

  host.replaceChildren(
    summary,
    el(
      'section',
      { class: 'card' },
      el('h3', { class: 'card-title', text: `Every entry (${list.length})` }),
      el('p', { class: 'card-sub', text: 'Newest first. Points shown use the current scoring settings.' }),
      ...entryCards,
    ),
  );
}

/* ------------------------------------------------------------------ tabs & wiring */

const TABS = ['leaderboard', 'categories', 'scoring', 'team'];

function showTab(name: string, pushHash = true) {
  if (!TABS.includes(name)) name = 'leaderboard';
  if (pushHash && location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  }
  for (const panel of document.querySelectorAll<HTMLElement>('.panel')) {
    panel.hidden = panel.dataset.tab !== name;
  }
}

function renderAll(opts: { keepScoring?: boolean } = {}) {
  const teams = buildTeams(entries, scoring);
  renderTiles(teams);
  renderLeaderboard(teams);
  renderCategories(teams);
  renderTeamPicker(teams);
  renderTeam();
  if (!opts.keepScoring) renderScoring();
}

function stamp() {
  $('#fetched').textContent = `Airtable data as of ${new Date(fetchedAt).toLocaleTimeString()}`;
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('.tab')) {
  btn.addEventListener('click', () => showTab(btn.dataset.tab!));
}

$<HTMLSelectElement>('#team-select').addEventListener('change', (ev) => {
  selectedTeam = (ev.target as HTMLSelectElement).value;
  renderTeam();
});

$('#refresh').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    const res = await fetch('/api/entries?refresh=1');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    entries = data.entries;
    unattributed = data.unattributed;
    fetchedAt = data.fetchedAt;
    scoring = data.scoring;
    renderAll();
    stamp();
  } catch (err) {
    alert(`Could not refresh from Airtable:\n${err instanceof Error ? err.message : err}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
});

$('#reset').addEventListener('click', async () => {
  if (!confirm('Reset every point value and weight to the defaults?')) return;
  const res = await fetch('/api/scoring', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reset: true }),
  });
  const data = await res.json();
  if (res.ok) {
    scoring = data.scoring;
    renderAll();
  } else alert(data.error ?? 'Reset failed');
});

addEventListener('hashchange', () => showTab(location.hash.slice(1), false));

renderAll();
stamp();
showTab(location.hash.slice(1) || 'leaderboard', false);
