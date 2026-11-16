// The dashboard's work views (HITLD-152): Your move, the plan, the roadmap's fewest-crossings
// layout, Proposals and Flow, from a fixture tracker with a diamond and a chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { git, isolatedEnv, itemText, makeRepo, put } from './tracker-fixture.mjs';

const HOME = isolatedEnv();
const NOW = '2026-11-16T12:00:00Z';

/** @param {string[]} argv @param {string} cwd */
async function hitld(argv, cwd) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: { ...HOME } });
  return { code, json: JSON.parse(out) };
}

/** Commit everything at a given time. @param {string} root @param {string} message @param {string} at */
function commitAt(root, message, at) {
  git(root, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  });
}

/** @param {string} id @param {string} title @param {Record<string, string | string[]>} [extra] */
const item = (id, title, extra = {}) => ({
  [`work/items/${id}-${title
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .replace(/-$/, '')}.md`]: itemText({
    id,
    title,
    kind: 'work',
    state: 'planned',
    project: 'W-2',
    created: '2026-11-10',
    ...extra,
  }),
});

/**
 * The base fixture (W-3 done; W-4 ready, needs W-3; W-5 blocked, needs W-4 and the owner's
 * decision W-6), plus a diamond W-10 → W-11, W-12 → W-13, a chain W-20 → W-21 → W-22 in a second
 * project W-19, an outside wait W-30, and proposals W-40 (needs W-6) and W-41 (needs nothing). The
 * history: everything planned on 2026-11-12, W-10 done on 2026-11-14, W-11 in progress on
 * 2026-11-15.
 */
function fixture() {
  const root = makeRepo({ commit: false });
  put(root, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
    }),
    'work/projects/W-19-the-second-project.md': itemText({
      id: 'W-19',
      title: 'The second project',
      kind: 'project',
      state: 'planned',
      owner: 'owner',
    }),
    ...item('W-6', 'Which way?', { kind: 'decision', decider: 'owner', created: '2026-11-12' }),
    ...item('W-10', 'Diamond top'),
    ...item('W-11', 'Diamond left', { needs: ['W-10'] }),
    ...item('W-12', 'Diamond right', { needs: ['W-10'] }),
    ...item('W-13', 'Diamond bottom', { needs: ['W-11', 'W-12'] }),
    ...item('W-20', 'Chain one', { project: 'W-19' }),
    ...item('W-21', 'Chain two', { project: 'W-19', needs: ['W-20'] }),
    ...item('W-22', 'Chain three', { project: 'W-19', needs: ['W-21'] }),
    ...item('W-30', 'The vendor answers', { kind: 'external', waiting_on: 'vendor' }),
    ...item('W-40', 'A bet on <b>bold</b> things', { state: 'proposed', needs: ['W-6'] }),
    ...item('W-41', 'A free bet', { state: 'proposed' }),
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAt(root, 'fixture', '2026-11-12T10:00:00Z');
  put(root, item('W-10', 'Diamond top', { state: 'done' }));
  commitAt(root, 'W-10 done', '2026-11-14T10:00:00Z');
  put(root, item('W-11', 'Diamond left', { needs: ['W-10'], state: 'in-progress' }));
  commitAt(root, 'W-11 in progress', '2026-11-15T10:00:00Z');
  return root;
}

/** @param {string} root */
async function dashboard(root) {
  const r = await hitld(['dashboard', '--out', 'out', '--json', '--now', NOW], root);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.warnings, undefined, JSON.stringify(r.json.warnings));
  return { report: r.json.report, html: readFileSync(join(root, 'out', 'dashboard.html'), 'utf8') };
}

/** The HTML of one view's section. @param {string} html @param {string} id */
const view = (html, id) => {
  const m = new RegExp(`<section class="view" id="${id}"[^>]*>([\\s\\S]*?)\\n</section>`).exec(
    html,
  );
  assert.ok(m, `the page has the ${id} view`);
  return m[1];
};

test('the page has its views as tabs that need no script, Your move first and checked', async () => {
  const { html } = await dashboard(fixture());
  const tabs = [
    ...html.matchAll(/<input class="tab-input" type="radio" name="view" id="tab-([a-z]+)"/g),
  ].map((m) => m[1]);
  assert.equal(tabs[0], 'move');
  assert.ok(tabs.includes('roadmap') && tabs.includes('spend'));
  assert.match(html, /id="tab-move" aria-controls="move" checked>/);
  for (const t of tabs) {
    assert.match(html, new RegExp(`<label for="tab-${t}">`));
    assert.match(html, new RegExp(`#tab-${t}:checked~main #${t}\\{display:block\\}`));
  }
  assert.match(
    html,
    /Read 2026-11-16T12:00:00.000Z from the tracker in this repository at commit [0-9a-f]+ on main/,
  );
});

test('Your move: each section leads with its number, most waited-on first, with ages and file links', async () => {
  const { report, html } = await dashboard(fixture());
  const m = report.work.move;
  assert.deepEqual(
    m.decisions.map((/** @type {any} */ d) => [d.id, d.waiting_on_it, d.age_days]),
    [['W-6', 2, 4]],
    'W-5 and the proposal W-40 wait on W-6; created four days before',
  );
  assert.deepEqual(
    m.ready.map((/** @type {any} */ r) => r.id),
    ['W-20', 'W-4', 'W-12'],
    'the critical path (W-20, W-21, W-22 is the longest chain) first, then most waited-on',
  );
  assert.deepEqual(
    m.in_progress.map((/** @type {any} */ p) => p.id),
    ['W-11'],
  );
  assert.deepEqual(
    m.outside.map((/** @type {any} */ o) => [o.id, o.waiting_on]),
    [['W-30', 'vendor']],
  );
  const move = view(html, 'move');
  assert.match(move, /<h3><span class="num">1<\/span> Decisions waiting on you<\/h3>/);
  assert.match(move, /<h3><span class="num">3<\/span> Ready to start<\/h3>/);
  assert.match(move, /<h3><span class="num">1<\/span> In progress<\/h3>/);
  assert.match(move, /<h3><span class="num">1<\/span> Waiting outside<\/h3>/);
  assert.match(
    move,
    /<h3><span class="num">0<\/span> Branches waiting for your merge or on checks<\/h3>/,
  );
  assert.match(
    move,
    /<li data-item="W-6"><a class="file" href="work\/items\/W-6-which-way.md">W-6<\/a> Which way\? <span class="meta">waiting 4 days<\/span> <span class="pill">2 items wait on it<\/span>/,
  );
});

test('the plan: the diamond and the chain as inline SVG in project lanes, with the critical path, the ready items and a list', async () => {
  const { html } = await dashboard(fixture());
  const plan = view(html, 'plan');
  // Planned and in-progress items by default: W-4, W-5, W-6, W-11, W-12, W-13, W-20, W-21, W-22, W-30.
  assert.match(
    plan,
    /<svg class="mg pg" [^>]*aria-label="Item graph: 10 items in 2 lanes over 3 steps, 6 needs between them, 0 crossings"/,
  );
  // The diamond's done top is not drawn; its left and right both feed its bottom.
  for (const [from, to] of [
    ['W-11', 'W-13'],
    ['W-12', 'W-13'],
    ['W-20', 'W-21'],
    ['W-21', 'W-22'],
    ['W-4', 'W-5'],
    ['W-6', 'W-5'],
  ]) {
    assert.match(plan, new RegExp(`data-from="${from}" data-to="${to}"`), `${from} → ${to}`);
  }
  assert.doesNotMatch(plan, /data-item="W-10"/, 'done items are left out by default');
  assert.doesNotMatch(plan, /data-item="W-40"/, 'proposed items have their own view');
  // The chain is the critical path, in the accent; the ready items say so.
  assert.match(plan, /Critical path: W-20 → W-21 → W-22\./);
  assert.match(plan, /<g class="pg-wire critical" data-from="W-20" data-to="W-21">/);
  assert.match(plan, /<g class="pg-node st-ready critical">/);
  assert.match(
    plan,
    /<a href="work\/items\/W-12-diamond-right.md" data-item="W-12" aria-label="W-12 Diamond right: Ready"><g class="pg-node st-ready">/,
  );
  assert.match(plan, /aria-label="W-13 Diamond bottom: Blocked; needs W-11, W-12"/);
  assert.match(plan, /aria-label="W-11 Diamond left: In progress"/);
  // Lanes are projects.
  assert.match(plan, /<text class="mg-lane-name pg-lane" [^>]*>W-2 The project<\/text>/);
  assert.match(plan, /<text class="mg-lane-name pg-lane" [^>]*>W-19 The second pro…<\/text>/);
  // The same nodes as a list, for a screen reader.
  assert.match(plan, /<details class="plan-list"><summary>The same 10 items as a list<\/summary>/);
  assert.match(
    plan,
    /<li data-item="W-13"><a class="file" href="work\/items\/W-13-diamond-bottom.md">W-13<\/a> Diamond bottom: Blocked; needs W-11, W-12<\/li>/,
  );
  assert.match(
    plan,
    /<li data-item="W-11">[^<]*<a[^>]*>W-11<\/a> Diamond left: In progress; needs W-10 \(done\)<\/li>/,
  );
});

test('the plan is cut by project past its size setting, and shows the states the setting names', async () => {
  const root = fixture();
  const policy = JSON.parse(readFileSync(join(root, '.human-in-the-lead/policy.json'), 'utf8'));
  policy.reports = {
    dashboard_plan_max_items: 7,
    dashboard_plan_states: ['planned', 'in-progress', 'done'],
  };
  put(root, { '.human-in-the-lead/policy.json': JSON.stringify(policy) });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'settings');
  const { html } = await dashboard(root);
  const plan = view(html, 'plan');
  assert.match(plan, /data-item="W-10"/, 'done items are drawn when the setting names done');
  assert.doesNotMatch(plan, /data-item="W-20"/);
  assert.match(
    plan,
    /Cut at 7 items by project \(the setting reports.dashboard_plan_max_items\)\. Not drawn: W-19 The second project \(3 items\)\./,
  );
});

test('the layout: columns by longest path, barycenter sweeps remove crossings, loops are cut, groups and a grid', async () => {
  const { acyclic, countCrossings, fewestCrossings, longestPathLayers, reduceCrossings } =
    await import('../lib/dashboard/layout.mjs');
  /** @type {[string, string][]} */
  const diamond = [
    ['W-1', 'W-2'],
    ['W-1', 'W-3'],
    ['W-2', 'W-4'],
    ['W-3', 'W-4'],
  ];
  const layers = longestPathLayers(['W-1', 'W-2', 'W-3', 'W-4'], diamond);
  assert.deepEqual(
    [...layers],
    [
      ['W-1', 0],
      ['W-2', 1],
      ['W-3', 1],
      ['W-4', 2],
    ],
  );
  // A chain that skips a column still takes its longest path: W-5 → W-6 → W-7, and W-5 → W-7.
  assert.equal(
    longestPathLayers(
      ['W-5', 'W-6', 'W-7'],
      [
        ['W-5', 'W-6'],
        ['W-6', 'W-7'],
        ['W-5', 'W-7'],
      ],
    ).get('W-7'),
    2,
  );
  // In ID order W-1 sits over W-2 and W-3 over W-4, so W-1 → W-4 and W-2 → W-3 cross once.
  /** @type {[string, string][]} */
  const crossed = [
    ['W-1', 'W-4'],
    ['W-2', 'W-3'],
  ];
  assert.equal(
    countCrossings(
      [
        ['W-1', 'W-2'],
        ['W-3', 'W-4'],
      ],
      crossed,
    ),
    1,
  );
  const r = reduceCrossings(
    new Map([
      ['W-1', 0],
      ['W-2', 0],
      ['W-3', 1],
      ['W-4', 1],
    ]),
    crossed,
  );
  assert.equal(r.crossings, 0);
  assert.deepEqual(r.layers, [
    ['W-1', 'W-2'],
    ['W-4', 'W-3'],
  ]);
  // A loop is cut, so the layout ends.
  assert.deepEqual(
    acyclic(
      ['W-1', 'W-2'],
      [
        ['W-1', 'W-2'],
        ['W-2', 'W-1'],
      ],
    ),
    [['W-1', 'W-2']],
  );
  // Linked nodes grouped, the group holding the critical path first; unlinked ones in a grid.
  const f = fewestCrossings(
    ['W-1', 'W-2', 'W-3', 'W-4', 'W-8', 'W-9', 'W-20', 'W-30'],
    [...diamond, ['W-8', 'W-9']],
    { first: ['W-9'] },
  );
  assert.deepEqual(
    f.groups.map((g) => g.ids),
    [
      ['W-8', 'W-9'],
      ['W-1', 'W-2', 'W-3', 'W-4'],
    ],
  );
  assert.deepEqual(f.grid, ['W-20', 'W-30']);
  assert.equal(f.groups[1].crossings, 0);
});

test('the roadmap offers a second layout, fewest crossings, with no script', async () => {
  const { html } = await dashboard(fixture());
  const roadmap = view(html, 'roadmap');
  assert.match(
    roadmap,
    /<input class="tab-input" type="radio" name="roadmap-layout" id="rm-lanes" checked><label for="rm-lanes">By project<\/label>/,
  );
  assert.match(roadmap, /<label for="rm-fewest">Fewest crossings<\/label>/);
  assert.match(
    roadmap,
    /<div class="wrap rm-fewest"><svg class="mg" [^>]*aria-label="Milestone map, fewest crossings: /,
  );
  assert.match(html, /#rm-fewest:checked~\.rm-fewest\{display:block\}/);
});

test('Proposals: every proposed item, what stands between it and committing, and what waits on it', async () => {
  const { html } = await dashboard(fixture());
  const p = view(html, 'proposals');
  assert.match(p, /<span class="num">2<\/span> proposed items, 1 ready to commit\./);
  assert.match(
    p,
    /<tr data-item="W-40"><td data-label="Idea"><a class="file" href="work\/items\/W-40-a-bet-on-b-bold-b-things.md">W-40<\/a> A bet on &lt;b&gt;bold&lt;\/b&gt; things<\/td><td data-label="Before committing">Waits on your answer: W-6<\/td><td data-label="Waiting on it">0<\/td><\/tr>/,
  );
  assert.match(
    p,
    /<tr data-item="W-41">.*?<td data-label="Before committing">Ready to commit<\/td>/,
  );
  assert.doesNotMatch(p, /<b>bold<\/b>/, 'tracker text is escaped');
  assert.doesNotMatch(p, /data-item="W-4"/, 'planned items are not proposals');
});

test('Flow: stage bands day by day from the committed history, then the measures beside their pairs', async () => {
  const { report, html } = await dashboard(fixture());
  const days = report.work.flow.days;
  assert.deepEqual(
    days.map((/** @type {any} */ d) => [
      d.day,
      d.done,
      d['in-progress'],
      d.ready,
      d.blocked,
      d.proposed,
    ]),
    [
      // W-3 done; ready: W-4, W-6, W-10, W-20, W-30; blocked: W-5, W-11, W-12, W-13, W-21, W-22.
      ['2026-11-12', 1, 0, 5, 6, 2],
      ['2026-11-13', 1, 0, 5, 6, 2],
      // W-10 done: W-11 and W-12 ready; still blocked: W-5, W-13, W-21, W-22.
      ['2026-11-14', 2, 0, 6, 4, 2],
      // W-11 in progress.
      ['2026-11-15', 2, 1, 5, 4, 2],
      ['2026-11-16', 2, 1, 5, 4, 2],
    ],
  );
  const m = report.work.flow.measures;
  assert.equal(m.done_last_7_days, 2);
  assert.equal(m.lead_time_items, 1, 'W-10: planned on the 12th, done on the 14th');
  assert.equal(m.lead_time_median_days, 2);
  const flow = view(html, 'flow');
  assert.match(
    flow,
    /<svg class="mg flow" viewBox="0 0 720 220" role="img" aria-label="Items by stage at the end of each day, 2026-11-12 to 2026-11-16">/,
  );
  assert.equal(
    (flow.match(/<rect class="fl st-/g) ?? []).length,
    4 * 3 + 5 * 2,
    'no in-progress band before the 15th',
  );
  assert.match(
    flow,
    /<th scope="row" data-label="Measure">Throughput<\/th><td data-label="Now">2 items done in the last 7 days; 0 in the 7 before<\/td><td data-label="Its pair">Change failure rate<\/td><td data-label="Pair now">No merges in the ledger yet<\/td>/,
  );
  assert.match(flow, /Median 2.0 days, over 1 item done in the last 30 days/);
});
