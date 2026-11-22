// A project's own panels (HITLD-692): views.json beside tracker.json, checked against the data
// contract's fields and the declared ones, each of the six panel types resolved into the contract
// and drawn on the page with no script, in a tab the project names; hostile values stay text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { checkViews } from '../lib/dashboard/panels.mjs';
import { git, isolatedEnv, itemText, makeRepo, put } from './tracker-fixture.mjs';
import { assertPageSafe, scriptElements } from './helpers/page-safety.mjs';

const HOME = isolatedEnv();
const NOW = '2026-11-16T12:00:00Z';

/** @param {string[]} argv @param {string} cwd */
async function hitld(argv, cwd) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: { ...HOME } });
  return { code, json: JSON.parse(out) };
}

/** @param {string} root @param {string} message @param {string} at */
function commitAt(root, message, at) {
  git(root, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  });
}

/** @param {string} id @param {string} title @param {Record<string, string | string[]>} [extra] */
const item = (id, title, extra = {}) => ({
  [`work/items/${id}-${id.toLowerCase()}.md`]: itemText({
    id,
    title,
    kind: 'work',
    state: 'planned',
    project: 'W-2',
    created: '2026-11-10',
    ...extra,
  }),
});

/** @type {import('../lib/dashboard/work.mjs').DeclaredField[]} */
const FIELDS = [
  { name: 'team', type: 'string', values: ['core', 'web'], description: 'The team that does it.' },
  { name: 'points', type: 'integer', description: 'Its size in points.' },
  { name: 'due', type: 'string', description: 'When it is due, YYYY-MM-DD.' },
  { name: 'note', type: 'string', description: 'A note.' },
];

/** The six panel types, over contract fields and declared ones. */
const SIX = {
  schema_version: 1,
  title: 'Team board',
  panels: [
    {
      id: 'sized',
      title: 'Sized work',
      description: 'Items with points, largest first.',
      type: 'table',
      where: [{ field: 'points', set: true }],
      columns: ['title', 'team', 'points', 'stage'],
      sort: 'points',
      order: 'descending',
    },
    { id: 'by-stage', title: 'By stage', type: 'board', group_by: 'stage' },
    { id: 'by-team', title: 'By team', type: 'bar', group_by: 'fields.team' },
    {
      id: 'done-over-time',
      title: 'Done over time',
      type: 'line',
      date: 'reached.done',
      interval: 'day',
      cumulative: true,
    },
    {
      id: 'due-dates',
      title: 'Due dates',
      type: 'timeline',
      date: 'due',
      where: [{ field: 'kind', is: 'work' }],
    },
    {
      id: 'waits',
      title: 'What waits on what',
      type: 'graph',
      where: [
        { field: 'kind', is: 'work' },
        { field: 'state', in: ['planned', 'done'] },
      ],
    },
  ],
};

/**
 * A tracker with declared fields and a history: W-7 to W-9 planned on 2026-11-12, W-7 done on
 * 2026-11-13 and W-8 done on 2026-11-14.
 * @param {unknown} [views] views.json, or none
 * @param {Record<string, string | string[]>} [hostile] extra fields on W-9
 */
function fixture(views, hostile = {}) {
  const root = makeRepo({ commit: false });
  put(root, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
    }),
    '.human-in-the-lead/tracker.json': JSON.stringify({ schema_version: 1, fields: FIELDS }),
    ...item('W-7', 'Write the parser', { team: 'core', points: '5', due: '2026-11-20' }),
    ...item('W-8', 'Draw the page', { team: 'web', points: '3', needs: ['W-7'] }),
    ...item('W-9', 'Ship it', { needs: ['W-8'], due: '2026-11-30', ...hostile }),
    ...(views === undefined ? {} : { '.human-in-the-lead/views.json': JSON.stringify(views) }),
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAt(root, 'fixture', '2026-11-12T10:00:00Z');
  put(
    root,
    item('W-7', 'Write the parser', {
      team: 'core',
      points: '5',
      due: '2026-11-20',
      state: 'done',
    }),
  );
  commitAt(root, 'W-7 done', '2026-11-13T10:00:00Z');
  put(
    root,
    item('W-8', 'Draw the page', { team: 'web', points: '3', needs: ['W-7'], state: 'done' }),
  );
  commitAt(root, 'W-8 done', '2026-11-14T10:00:00Z');
  return root;
}

/** @param {string} root */
async function dashboard(root) {
  const r = await hitld(['dashboard', '--out', 'out', '--json', '--now', NOW], root);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  return {
    report: r.json.report,
    warnings: r.json.warnings,
    html: readFileSync(join(root, 'out', 'dashboard.html'), 'utf8'),
  };
}

/** One view's section. @param {string} html @param {string} id */
const view = (html, id) =>
  new RegExp(
    `<section class="view" id="${id}"[^>]*>([\\s\\S]*?)\\n</section>\\n(?:<section class="view"|</main>)`,
  ).exec(html)?.[1];

/** One panel's section. @param {string} html @param {string} id */
const panel = (html, id) => {
  const m = new RegExp(
    `<section class="pn pn-is-[a-z]+" id="pn-${id}"[^>]*>([\\s\\S]*?)\\n</section>`,
  ).exec(html);
  assert.ok(m, `the page has panel ${id}`);
  return m[1];
};

/** @param {any} report @param {string} id */
const resolved = (report, id) => report.views.panels.find((/** @type {any} */ p) => p.id === id);

test('a project with no views.json: views is null, no extra tab, and check views says so', async () => {
  const root = fixture();
  const { report, html, warnings } = await dashboard(root);
  assert.equal(warnings, undefined);
  assert.equal(report.views, null);
  assert.deepEqual(schemas().validate('dashboard-data', report), []);
  assert.doesNotMatch(html, /id="tab-panels"|class="pn/);
  const r = await hitld(['check', 'views'], root);
  assert.equal(r.code, 0);
  assert.equal(r.json.path, null);
  assert.match(r.json.message, /built-in views alone/);
});

test('the built-in views stay as they are: the project panels add a last tab and nothing else', async () => {
  const without = await dashboard(fixture());
  const withViews = await dashboard(fixture(SIX));
  for (const id of ['move', 'roadmap', 'plan', 'proposals', 'flow', 'spend']) {
    assert.equal(view(withViews.html, id), view(without.html, id), `the ${id} view is unchanged`);
  }
  const tabs = [...withViews.html.matchAll(/<label for="tab-([a-z]+)">([^<]*)<\/label>/g)].map(
    (m) => [m[1], m[2]],
  );
  assert.deepEqual(tabs.at(-1), ['panels', 'Team board'], 'the last tab, named by the project');
  assert.deepEqual(
    tabs.slice(0, -1),
    [...without.html.matchAll(/<label for="tab-([a-z]+)">([^<]*)<\/label>/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
  // The page is still drawn from the contract alone.
  const { renderHtml } = await import('../lib/quota/report.mjs');
  assert.equal(renderHtml(JSON.parse(JSON.stringify(withViews.report))), withViews.html);
});

test('each of the six panel types resolves into the contract and draws with no script', async () => {
  const root = fixture(SIX);
  const { report, html, warnings } = await dashboard(root);
  assert.equal(warnings, undefined, JSON.stringify(warnings));
  assert.deepEqual(schemas().validate('dashboard-data', report), []);
  assert.equal(report.api_version, 2, 'adding views keeps the version');
  assert.deepEqual(report.views.errors, []);
  assert.equal(report.views.title, 'Team board');
  assertPageSafe(html);

  // table: chosen columns, sorted by a declared field, descending; only items with points.
  const t = resolved(report, 'sized');
  assert.deepEqual(t.columns, ['title', 'team', 'points', 'stage']);
  assert.deepEqual(t.rows, [
    { id: 'W-7', cells: ['Write the parser', 'core', 5, 'done'] },
    { id: 'W-8', cells: ['Draw the page', 'web', 3, 'done'] },
  ]);
  const th = panel(html, 'sized');
  assert.match(th, /<h3 id="pn-sized-h">Sized work<\/h3>/);
  assert.match(th, /<th scope="col">points<\/th>/);
  assert.match(th, /2 items where points is set\./);

  // board: a column per stage, in the contract's order, with the items in each.
  const b = resolved(report, 'by-stage');
  assert.deepEqual(
    b.columns
      .filter((/** @type {any} */ c) => c.ids.length)
      .map((/** @type {any} */ c) => [c.value, c.ids]),
    [
      ['blocked', ['W-5']],
      ['ready', ['W-4', 'W-6', 'W-9']],
      ['done', ['W-3', 'W-7', 'W-8']],
    ],
  );
  assert.deepEqual(
    b.columns.map((/** @type {any} */ c) => c.value),
    ['proposed', 'blocked', 'ready', 'in-progress', 'done', 'dropped'],
  );
  assert.match(panel(html, 'by-stage'), /<h4>done <span class="num">3<\/span><\/h4><ul><li>/);

  // bar: counts by a declared field, its values in order, then the items with none.
  assert.deepEqual(resolved(report, 'by-team').bars.slice(0, 2), [
    { value: 'core', count: 1 },
    { value: 'web', count: 1 },
  ]);
  assert.equal(resolved(report, 'by-team').bars.at(-1).value, null);
  assert.match(panel(html, 'by-team'), /<th scope="row">core<\/th><td>1<\/td>/);
  assert.match(panel(html, 'by-team'), /<svg class="pn-bar" aria-hidden="true"/);

  // line: a cumulative count over time, from the committed history (reached.done).
  const l = resolved(report, 'done-over-time');
  assert.deepEqual(l.points, [
    { at: '2026-11-12', count: 1 },
    { at: '2026-11-13', count: 2 },
    { at: '2026-11-14', count: 3 },
  ]);
  assert.ok(l.undated > 0, 'the items never done are counted as undated, not dropped silently');
  const lh = panel(html, 'done-over-time');
  assert.match(lh, /<svg class="pn-svg" aria-hidden="true"/);
  assert.match(lh, /<details><summary>The counts as a table<\/summary>/);
  assert.match(lh, /<th scope="row">2026-11-14<\/th><td>3<\/td>/);

  // timeline: items on a declared date field, in date order.
  const tl = resolved(report, 'due-dates');
  assert.deepEqual(tl.entries, [
    { id: 'W-7', start: '2026-11-20', end: null },
    { id: 'W-9', start: '2026-11-30', end: null },
  ]);
  assert.match(
    panel(html, 'due-dates'),
    /<ol class="pn-list"><li><time datetime="2026-11-20">2026-11-20<\/time>: <a class="file"[^>]*>W-7<\/a> Write the parser<\/li>/,
  );

  // graph: the items and their needs, as edges [from, to].
  const g = resolved(report, 'waits');
  assert.deepEqual(g.edges, [
    ['W-3', 'W-4'],
    ['W-4', 'W-5'],
    ['W-7', 'W-8'],
    ['W-8', 'W-9'],
  ]);
  assert.equal(g.outside, 1, "W-5's need on the decision W-6, which the filter leaves out");
  assert.match(panel(html, 'waits'), /<li><a class="file"[^>]*>W-9<\/a> Ship it; needs: W-8<\/li>/);

  // Every panel has a heading for a screen reader and text that reads without CSS.
  for (const p of SIX.panels) {
    const s = panel(html, p.id);
    assert.match(html, new RegExp(`id="pn-${p.id}" aria-labelledby="pn-${p.id}-h"`));
    const text = s.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
    assert.match(text, /W-\d|\d item/, `panel ${p.id} has a text fallback`);
  }
});

test('a panel naming an undeclared field, or a value that does not exist, is refused by name', async () => {
  const views = {
    schema_version: 1,
    title: 'Team board',
    panels: [
      { id: 'ok', title: 'Fine', type: 'bar', group_by: 'team' },
      { id: 'typo', title: 'By teem', type: 'bar', group_by: 'teem' },
      {
        id: 'bad-filter',
        title: 'Bad filter',
        type: 'table',
        columns: ['title'],
        where: [{ field: 'colour', is: 'red' }],
      },
      {
        id: 'bad-value',
        title: 'Bad value',
        type: 'table',
        columns: ['title'],
        where: [{ field: 'team', is: 'mobile' }],
      },
    ],
  };
  const root = fixture(views);
  const r = await hitld(['check', 'views'], root);
  assert.equal(r.code, 1);
  assert.equal(r.json.ok, false);
  assert.deepEqual(
    r.json.panels.map((/** @type {any} */ p) => p.id),
    ['ok'],
  );
  const messages = r.json.errors.map((/** @type {any} */ e) => [e.panel, e.path, e.message]);
  assert.deepEqual(messages, [
    [
      'typo',
      'panels[1].group_by',
      'panel "typo": "teem" is not a field of the dashboard data contract or one tracker.json declares',
    ],
    [
      'bad-filter',
      'panels[2].where[0].field',
      'panel "bad-filter": "colour" is not a field of the dashboard data contract or one tracker.json declares',
    ],
    [
      'bad-value',
      'panels[3].where[0].is',
      'panel "bad-value": "mobile" is not a value of "team" (one of core, web)',
    ],
  ]);
  // The dashboard shows the good panel, and names the refused ones in their place: no empty panel.
  const { report, html, warnings } = await dashboard(root);
  assert.deepEqual(warnings, ['views.json: 3 problems; run hitld check views']);
  assert.deepEqual(schemas().validate('dashboard-data', report), []);
  assert.deepEqual(
    report.views.panels.map((/** @type {any} */ p) => p.id),
    ['ok'],
  );
  const tab = /** @type {string} */ (view(html, 'panels'));
  assert.match(tab, /role="alert"><strong>3 panels refused<\/strong>/);
  assert.match(tab, /panel &quot;typo&quot;: &quot;teem&quot; is not a field/);
  assert.doesNotMatch(tab, /id="pn-typo"/);
});

test('views.json problems: the schema, the keys a type takes, dates, relations and states', () => {
  /** @param {Record<string, any>} p */
  const one = (p) =>
    checkViews(
      { schema_version: 1, title: 'T', panels: [{ id: 'p', title: 'P', ...p }] },
      FIELDS,
    ).errors.map((e) => e.message);
  assert.deepEqual(one({ type: 'pie', group_by: 'state' }), [
    'must be one of "table", "board", "bar", "line", "timeline", "graph"; got "pie"',
  ]);
  assert.deepEqual(one({ type: 'bar' }), ['panel "p": a bar panel needs "group_by"']);
  assert.deepEqual(one({ type: 'bar', group_by: 'state', columns: ['id'] }), [
    'panel "p": a bar panel does not take "columns"',
  ]);
  assert.deepEqual(one({ type: 'line', date: 'title' }), [
    'panel "p": "title" is not a date (created, reached.<state>, or declared text holding YYYY-MM-DD)',
  ]);
  assert.match(
    one({ type: 'line', date: 'reached.shipped' })[0],
    /"reached.shipped" names no state/,
  );
  assert.deepEqual(one({ type: 'graph', relation: 'points' }), [
    'panel "p": "points" holds integer values, not IDs',
  ]);
  assert.deepEqual(
    one({ type: 'bar', group_by: 'kind', where: [{ field: 'state', is: 'shipped' }] }),
    [
      'panel "p": "shipped" is not a value of "state" (one of proposed, planned, in-progress, done, dropped)',
    ],
  );
  assert.deepEqual(
    one({ type: 'bar', group_by: 'kind', where: [{ field: 'points', at_least: 'big' }] }),
    ['panel "p": at_least on "points" takes a number, not "big"'],
  );
  assert.deepEqual(
    one({ type: 'bar', group_by: 'kind', where: [{ field: 'state', is: 'done', not: 'x' }] }),
    ['must have at most 2 keys'],
  );
  assert.deepEqual(one({ type: 'bar', group_by: 'kind', script: 'alert(1)' }), [
    'refused: the key names code to run, and data files never run code (design part 10)',
  ]);
  // Two panels with one id: the second is refused.
  const twice = checkViews(
    {
      schema_version: 1,
      title: 'T',
      panels: [
        { id: 'p', title: 'A', type: 'bar', group_by: 'kind' },
        { id: 'p', title: 'B', type: 'bar', group_by: 'kind' },
      ],
    },
    FIELDS,
  );
  assert.deepEqual(
    twice.panels.map((p) => p.title),
    ['A'],
  );
  assert.deepEqual(
    twice.errors.map((e) => e.message),
    ['panel "p": another panel has this id'],
  );
  // A problem outside the panels refuses the file.
  const file = checkViews({ schema_version: 1, panels: [] }, FIELDS);
  assert.deepEqual(file.panels, []);
  assert.ok(file.errors.every((e) => e.panel === null));
  assert.equal(file.title, 'Project panels');
});

test('views.json that is a link, or not JSON, is refused as a whole', async () => {
  const root = fixture(SIX);
  put(root, { '.human-in-the-lead/views.json': '{ not json' });
  let r = await hitld(['check', 'views'], root);
  assert.equal(r.code, 1);
  assert.match(r.json.errors[0].message, /views\.json cannot be read/);
  rmSync(join(root, '.human-in-the-lead', 'views.json'));
  put(root, { 'elsewhere.json': JSON.stringify(SIX) });
  symlinkSync(join(root, 'elsewhere.json'), join(root, '.human-in-the-lead', 'views.json'));
  r = await hitld(['check', 'views'], root);
  assert.equal(r.code, 1);
  assert.match(r.json.errors[0].message, /is not a regular file/);
});

test('nothing a project supplies is drawn as markup: hostile values stay escaped text', async () => {
  const long = 'x'.repeat(5000);
  const views = {
    schema_version: 1,
    title: '</label><script>tab()</script>',
    panels: [
      {
        id: 'notes',
        title: '</h3><script>alert("title")</script>',
        description: 'javascript:alert(1) <img src=x onerror=alert(2)>',
        type: 'table',
        columns: ['title', 'note'],
        where: [{ field: 'note', set: true }],
      },
      { id: 'by-note', title: 'By note', type: 'board', group_by: 'note' },
      { id: 'note-bars', title: 'Note bars', type: 'bar', group_by: 'note' },
      { id: 'graph', title: 'Graph', type: 'graph' },
      { id: 'times', title: 'Times', type: 'timeline', date: 'created' },
    ],
  };
  const root = fixture(views, {
    title: '"<script>alert(\'item\')</script>"',
    note: `"<script>alert(1)</script> https://evil.example/x ${long}"`,
  });
  const { report, html } = await dashboard(root);
  assert.deepEqual(report.views.errors, []);
  // The page holds HITLD's one inline script and no other; no script from data.
  const scripts = scriptElements(html);
  assert.equal(scripts.length, 1);
  // Item titles reach the script only as JSON with < escaped, so they cannot end it.
  assert.doesNotMatch(scripts[0].code, /<\/?script/i);
  for (const raw of [
    '<script>alert',
    '<script>tab',
    '<img',

    'href="javascript:',
    'href="https://evil',
  ]) {
    assert.ok(!html.includes(raw), `the page holds ${raw} as markup`);
  }
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'the value shows as text');
  assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'), 'the description shows as text');
  assert.ok(
    html.includes('&lt;/h3&gt;&lt;script&gt;alert(&quot;title&quot;)'),
    'the title shows as text',
  );
  assert.ok(!html.includes(long), 'very long text is cut');
  assert.ok(html.includes(`${'x'.repeat(100)}`) && html.includes('…'), 'and ends with an ellipsis');
  // The values stay data in the contract.
  const notes = resolved(report, 'notes');
  assert.match(String(notes.rows[0].cells[1]), /^<script>alert\(1\)<\/script> https:\/\/evil/);
});
