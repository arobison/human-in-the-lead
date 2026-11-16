// IDs never collide across sessions (design part 3.4, ID allocation): two sessions file from
// their own out-of-date copies of main. With a store remote, the number comes from the counter on
// the store repository, a compare and swap; without one, from origin, fetched first. Two items
// that still share an ID are refused by `hitld work check` and by the merge queue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { createIdCounter } from '../lib/store/remote-git.mjs';
import { duplicateIds } from '../lib/tracker/files/check.mjs';
import { loadWorkTree } from '../lib/tracker/files/tree.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import {
  commitAll,
  git,
  isolatedEnv,
  itemText,
  makeRepo,
  policyFor,
  put,
} from './tracker-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const HITLD = fileURLToPath(new URL('../bin/hitld.mjs', import.meta.url));

/**
 * An origin holding the fixture tracker on main, a bare repository standing in for the store's
 * host, and a clone of origin for each session, each with a home of its own.
 * @param {{ store?: boolean }} [o] store: the sessions share a store remote (default true)
 */
function sessions({ store = true } = {}) {
  const base = realpathSync(tempDir('hitld-ids-'));
  const seed = makeRepo({ commit: false });
  put(seed, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
    }),
  });
  chmodSync(join(seed, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAll(seed, 'fixture');
  const origin = join(base, 'origin.git');
  git(base, 'clone', '-q', '--bare', seed, origin);
  const host = join(base, 'store.git');
  mkdirSync(host);
  git(host, 'init', '-q', '--bare');
  /** @param {string} name */
  const session = (name) => {
    const root = join(base, name);
    git(base, 'clone', '-q', origin, root);
    git(root, 'config', 'user.name', 'Fixture');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    git(root, 'config', 'commit.gpgsign', 'false');
    const env = {
      ...isolatedEnv(),
      PATH: process.env.PATH ?? '',
      ...(store ? { HITLD_STORE_REMOTE: `file://${host}` } : {}),
    };
    return { root, env };
  };
  return { base, origin, host, a: session('a'), b: session('b') };
}

/**
 * Run `hitld work new` in a session as its own process.
 * @param {{ root: string, env: NodeJS.ProcessEnv }} s @param {string} title
 * @returns {Promise<Record<string, any>>}
 */
function workNew(s, title) {
  return new Promise((done, failed) => {
    const child = spawn(
      process.execPath,
      [HITLD, 'work', 'new', '--title', title, '--parent', 'W-2'],
      { cwd: s.root, env: s.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', failed);
    child.on('close', () => {
      try {
        done(JSON.parse(out));
      } catch {
        failed(new Error(`not JSON: ${out}`));
      }
    });
  });
}

/** @param {string} root */
const itemFiles = (root) => readdirSync(join(root, 'work', 'items')).sort();

test('two sessions filing at once from out-of-date copies of main get different IDs from the store counter', async () => {
  const p = sessions();
  // Both copies of main stop at W-6; neither sees the other's new file, which is never pushed.
  const [first, second] = await Promise.all([
    workNew(p.a, 'Filed on the first machine'),
    workNew(p.b, 'Filed on the second machine'),
  ]);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual([first.id_source, second.id_source], ['store-counter', 'store-counter']);
  assert.notEqual(first.id, second.id);
  assert.deepEqual([first.id, second.id].sort(), ['W-7', 'W-8']);
  // A third filing, again from a stale copy, goes on from the counter.
  const third = await workNew(p.a, 'Filed again on the first machine');
  assert.equal(third.id, 'W-9');
  // The counter holds numbers only.
  const shown = spawnSync('git', ['--git-dir', p.host, 'show', 'hitld-ids:ids.json'], {
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(shown.stdout), { schema_version: 1, taken: { W: { base: 9 } } });
});

test('a counter behind what origin holds still gives a number no one uses', async () => {
  const p = sessions();
  // The first session files and pushes W-7 to origin's main without the counter.
  openTracker({
    repoRoot: p.a.root,
    policy: policyFor([], { id: 'fixture' }),
    env: p.a.env,
    sharedIds: false,
  }).create({ kind: 'work', title: 'Filed without the counter', parent: 'W-2' });
  commitAll(p.a.root, 'W-7');
  git(p.a.root, 'push', '-q', 'origin', 'main');
  // The second session's copy of main is stale and the counter is empty.
  const made = await workNew(p.b, 'Filed after a fetch');
  assert.equal(made.id, 'W-8');
});

test('without a store remote, origin is fetched first: its main and its open branches count', async () => {
  const p = sessions({ store: false });
  // The first session pushes W-7 on main and W-8 on an open branch.
  const a = openTracker({
    repoRoot: p.a.root,
    policy: policyFor([], { id: 'fixture' }),
    env: p.a.env,
  });
  assert.equal(a.createEntity({ kind: 'work', title: 'On main', parent: 'W-2' }).id, 'W-7');
  commitAll(p.a.root, 'W-7');
  git(p.a.root, 'push', '-q', 'origin', 'main');
  git(p.a.root, 'switch', '-q', '-c', 'tracker/more');
  put(p.a.root, {
    'work/items/W-8-on-a-branch.md': itemText({
      id: 'W-8',
      title: 'On a branch',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
  });
  commitAll(p.a.root, 'W-8');
  git(p.a.root, 'push', '-q', 'origin', 'tracker/more');
  // The second session has not fetched since it cloned.
  assert.equal(itemFiles(p.b.root).includes('W-7-on-main.md'), false);
  const made = await workNew(p.b, 'Filed on the second machine');
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.id_source, 'origin');
  assert.equal(made.id, 'W-9');
});

test('a fetch that fails is a warning, and a counter that cannot be reached refuses the create', async () => {
  const p = sessions({ store: false });
  git(p.b.root, 'remote', 'set-url', 'origin', join(p.base, 'gone.git'));
  const warned = await workNew(p.b, 'Filed offline');
  assert.equal(warned.ok, true);
  assert.match(String(warned.warnings), /could not fetch origin/);

  const q = sessions();
  const env = { ...q.a.env, HITLD_STORE_REMOTE: `file://${join(q.base, 'no-such-store.git')}` };
  const before = itemFiles(q.a.root);
  const refused = await workNew({ root: q.a.root, env }, 'Filed with the store away');
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'id-counter-unreachable');
  assert.deepEqual(itemFiles(q.a.root), before, 'no file was written');
});

test('the counter takes numbers by compare and swap, and reads a damaged file as empty', () => {
  const base = realpathSync(tempDir('hitld-ids-counter-'));
  const host = join(base, 'store.git');
  mkdirSync(host);
  git(host, 'init', '-q', '--bare');
  const url = `file://${host}`;
  const one = createIdCounter({ url, dir: join(base, 'one') });
  const two = createIdCounter({ url, dir: join(base, 'two') });
  assert.equal(one.take({ key: 'W', block: 'base', from: 7 }), 7);
  assert.equal(two.take({ key: 'W', block: 'base', from: 7 }), 8, 'the second reads the first');
  assert.equal(one.take({ key: 'W', block: 'base', from: 20 }), 20, 'never below from');
  assert.equal(two.take({ key: 'W', block: 'second-machine', from: 100000 }), 100000);
  assert.equal(one.take({ key: 'APP', block: 'base', from: 1 }), 1, 'keys are separate');
  assert.throws(
    () => one.take({ key: 'w', block: 'base', from: 1 }),
    (/** @type {any} */ e) => e.code === 'remote-argument-invalid',
  );
  assert.throws(
    () =>
      createIdCounter({
        url: `file://${join(base, 'missing.git')}`,
        dir: join(base, 'three'),
      }).take({ key: 'W', block: 'base', from: 1 }),
    (/** @type {any} */ e) => e.code === 'remote-unreachable',
  );
  assert.equal(existsSync(join(base, 'one', 'HEAD')), true, 'a bare copy of its own');
});

test('work check and the merge queue refuse two items with one ID, naming both files', async () => {
  const root = makeRepo();
  const tracker = openTracker({ repoRoot: root, policy: policyFor(), env: isolatedEnv() });
  const layout = tracker.layout();
  // Two sessions each filed W-7 from their own copy of main.
  git(root, 'switch', '-q', '-c', 'tracker/second');
  put(root, {
    'work/items/W-7-filed-second.md': itemText({
      id: 'W-7',
      title: 'Filed second',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
  });
  commitAll(root, 'W-7 from the second session');
  git(root, 'switch', '-q', 'main');
  put(root, {
    'work/items/W-7-filed-first.md': itemText({
      id: 'W-7',
      title: 'Filed first',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
  });
  const main = commitAll(root, 'W-7 from the first session');

  // `hitld work check`, across branches.
  const across = tracker.check({ branches: true }).problems;
  assert.ok(
    across.some((x) =>
      /^W-7 is two different items: W-7-filed-first\.md .*W-7-filed-second\.md/.test(x),
    ),
    across.join('\n'),
  );
  // In one tree, as the merge queue sees the rebased branch.
  git(root, 'switch', '-q', '-c', 'both');
  git(root, 'merge', '-q', '--no-edit', 'tracker/second');
  assert.deepEqual(duplicateIds(loadWorkTree(root, layout)), [
    'W-7: in both work/items/W-7-filed-first.md and work/items/W-7-filed-second.md',
  ]);
  assert.ok(tracker.check().problems.includes(duplicateIds(loadWorkTree(root, layout))[0]));
  git(root, 'switch', '-q', 'main');
  git(root, 'branch', '-q', '-D', 'both');

  const result = await runMergeQueue({
    repoRoot: root,
    entries: [{ item: 'W-7', branch: 'tracker/second' }],
    settings: {
      mainBranch: 'main',
      batchMax: 4,
      fastChecks: [],
      fullSuite: ['true'],
      generated: [],
      flakeReruns: 0,
      trackerCheck: (dir) => duplicateIds(loadWorkTree(dir, layout)),
    },
  });
  assert.deepEqual(
    result.rejected.map((x) => [x.item, x.reason, x.output]),
    [
      [
        'W-7',
        'duplicate_id',
        'W-7: in both work/items/W-7-filed-first.md and work/items/W-7-filed-second.md',
      ],
    ],
  );
  assert.equal(git(root, 'rev-parse', 'main').trim(), main, 'main did not move');
});
