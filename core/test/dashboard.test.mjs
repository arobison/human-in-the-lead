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
