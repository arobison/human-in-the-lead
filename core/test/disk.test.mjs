// Free disk is a resource dispatch respects, and finished worktrees go (HITLD-130): the machine
// file's floor holds new work by name, run status, the watchdog and the digest warn near it, and the
// watchdog and the merge tear down the worktrees of merged branches and ended dispatches while
// keeping the primary checkout and every worktree a live dispatch holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { DEFAULT_DISK_FLOOR_MB, diskFloorMb, judgeDisk } from '../lib/machine/disk.mjs';
import { planDispatch } from '../lib/dispatch/plan.mjs';
import { teardownPlan } from '../lib/env/teardown.mjs';
import { CAPABILITIES } from '../harness/claude-code/capabilities.mjs';
import { writeSettingsFile } from '../lib/settings/files.mjs';
import { fakeWorkstation } from '../lib/eval/orchestrator-fixtures.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, git, item, makeConsumer } from './orchestrator-fixture.mjs';

const MB = 1024 * 1024;

/** A fake machine whose file systems have `freeMb` megabytes available. @param {number} freeMb */
const machineWith = (freeMb) => ({ ...fakeWorkstation(), freeBytes: () => freeMb * MB });

/**
 * Run hitld in the consumer with a fake machine.
 * @param {ReturnType<typeof makeConsumer>} c @param {string[]} argv
 * @param {import('../lib/machine/detect.mjs').Sources} [machine] @param {Record<string, string>} [env]
 */
async function hitld(c, argv, machine, env = {}) {
  let out = '';
  const exit = await main(argv, {
    out: (t) => (out += t),
    err: () => {},
    cwd: c.root,
    env: { ...c.env, ...env },
    ...(machine ? { machine } : {}),
  });
  return { exit, result: JSON.parse(out) };
}

/** A consumer with a run started and usage recorded, and a machine file with this floor. */
async function started(/** @type {number} */ floorMb) {
  const c = makeConsumer();
  writeSettingsFile(
    'machine',
    { schema_version: 1, disk_floor_mb: floorMb },
    { env: c.env, cwd: tmpdir() },
  );
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await hitld(c, ['run', 'start'], machineWith(100_000))).exit, 0);
  return c;
}

test('the floor is the machine file disk_floor_mb, else a conservative default', () => {
  assert.equal(diskFloorMb(null), DEFAULT_DISK_FLOOR_MB);
  assert.equal(diskFloorMb({ schema_version: 1 }), DEFAULT_DISK_FLOOR_MB);
  assert.equal(diskFloorMb({ schema_version: 1, disk_floor_mb: 800 }), 800);
  const at = { source: /** @type {const} */ ('file system'), where: 'the private store' };
  assert.equal(judgeDisk({ ...at, free_bytes: 700 * MB }, 800).state, 'below');
  assert.equal(judgeDisk({ ...at, free_bytes: 1000 * MB }, 800).state, 'near');
  assert.equal(judgeDisk({ ...at, free_bytes: 2000 * MB }, 800).state, 'ok');
  const unread = judgeDisk({ free_bytes: null, source: null, where: null }, 800);
  assert.equal(unread.state, 'unknown');
  const below = judgeDisk({ ...at, free_bytes: 700 * MB }, 800);
  assert.match(below.reason, /free disk is 700 MB .*below the disk floor of 800 MB/);
  assert.match(below.reason, /disk_floor_mb/);
});

test('the plan holds every item below the disk floor, inline work included, and names it', () => {
  const sizing = (/** @type {string} */ id, /** @type {0 | 1} */ tier) => ({
    item: id,
    tier,
    reasons: [],
    runs_as: /** @type {const} */ ('background'),
    model: 'small',
    effort: 'medium',
    estimate_tokens: 1000,
    estimate_source: /** @type {const} */ ('default'),
    areas: [],
    owner_review: null,
  });
  const queue = [
    { id: 'W-1', classification: 'public' },
    { id: 'W-2', classification: 'public' },
  ];
  const r = planDispatch({
    queue,
    sizes: new Map([
      ['W-1', sizing('W-1', 1)],
      ['W-2', sizing('W-2', 0)],
    ]),
    running: [],
    cap: 4,
    capabilities: CAPABILITIES,
    gate: () => ({ mode: 'normal', allow: true, reason: 'ok' }),
    disk: { state: 'below', reason: 'free disk is 10 MB, below the disk floor of 800 MB' },
  });
  assert.deepEqual(r.start, []);
  assert.deepEqual(r.inline, []);
  assert.deepEqual(
    r.held.map((h) => [h.item, h.reason]),
    [
      ['W-1', 'disk'],
      ['W-2', 'disk'],
    ],
  );
  assert.match(r.held[0].why, /below the disk floor of 800 MB/);
  const near = planDispatch({
    queue,
    sizes: new Map([
      ['W-1', sizing('W-1', 1)],
      ['W-2', sizing('W-2', 0)],
    ]),
    running: [],
    cap: 4,
    capabilities: CAPABILITIES,
    gate: () => ({ mode: 'normal', allow: true, reason: 'ok' }),
    disk: { state: 'near', reason: 'near' },
  });
  assert.deepEqual(
    near.start.map((s) => s.item),
    ['W-1'],
    'near the floor, work still starts',
  );
});

test('below the floor, dispatch plan holds work and dispatch start refuses by name', async () => {
  const c = await started(800);
  const low = machineWith(300);

  const planned = await hitld(c, ['dispatch', 'plan'], low);
  assert.equal(planned.exit, 0);
  assert.deepEqual(planned.result.start, []);
  assert.ok(planned.result.held.length > 0);
  assert.ok(planned.result.held.every((/** @type {any} */ h) => h.reason === 'disk'));
  assert.equal(planned.result.disk.state, 'below');
  assert.equal(planned.result.disk.floor_mb, 800);
  assert.match(planned.result.next, /tell the owner: free disk is 300 MB/);

  const refused = await hitld(c, ['dispatch', 'start', 'W-1'], low);
  assert.notEqual(refused.exit, 0);
  assert.equal(refused.result.error, 'disk-floor');
  assert.match(refused.result.message, /W-1 waits: free disk is 300 MB .*disk floor of 800 MB/);

  // With room again, the same item starts.
  const roomy = await hitld(c, ['dispatch', 'start', 'W-1'], machineWith(100_000));
  assert.equal(roomy.exit, 0, JSON.stringify(roomy.result));
  assert.equal(roomy.result.dispatch, 'D-1');
});

test('run status, the watchdog and the digest warn near the floor, before it is reached', async () => {
  const c = await started(800);
  const near = machineWith(1000);
  const roomy = machineWith(100_000);

  const status = await hitld(c, ['run', 'status'], near);
  assert.equal(status.result.disk.state, 'near');
  assert.match(status.result.next, /tell the owner: free disk is 1000 MB .*near the disk floor/);
  assert.equal((await hitld(c, ['run', 'status'], roomy)).result.disk, undefined);

  const watch = await hitld(c, ['dispatch', 'watch'], near, { HITLD_SESSION: 'cos' });
  assert.equal(watch.result.disk.state, 'near');
  assert.equal((await hitld(c, ['dispatch', 'watch'], roomy)).result.disk, undefined);

  const plan = await hitld(c, ['dispatch', 'plan'], near);
  assert.equal(plan.result.disk.state, 'near');
  assert.ok(plan.result.start.length > 0, 'near the floor, work still starts');

  const digest = await hitld(c, ['rights', 'digest', '--full'], near);
  assert.equal(digest.exit, 0, JSON.stringify(digest.result));
  assert.equal(digest.result.disk.state, 'near');
  assert.match(digest.result.text, /Disk near the floor/);
  assert.equal(digest.result.news, true);
  const calm = await hitld(c, ['rights', 'digest', '--full'], roomy);
  assert.equal(calm.result.disk, undefined);
  assert.doesNotMatch(calm.result.text, /Disk/);
});

test('teardown keeps the primary checkout and live worktrees, and removes finished ones', () => {
  /** @param {string} holder @param {Record<string, unknown>} [more] */
  const lease = (holder, more = {}) => ({
    holder,
    path: `/wt/${holder}`,
    branch: `hitld/${holder}`,
    repo_root: '/repo',
    base: 'main',
    adopted: false,
    state: /** @type {const} */ ('ready'),
    created_at: '2026-11-16T00:00:00Z',
    ...more,
  });
  const at = '2026-11-16T01:00:00Z';
  const events = [
    { event: 'dispatched', dispatch: 'D-1', item: 'W-1', branch: 'hitld/D-1', at },
    { event: 'dispatched', dispatch: 'D-2', item: 'W-2', branch: 'hitld/D-2', at },
    { event: 'reported', dispatch: 'D-2', item: 'W-2', at },
    { event: 'merged', item: 'W-2', at },
    { event: 'dispatched', dispatch: 'D-3', item: 'W-3', branch: 'hitld/D-3', at },
    { event: 'abandoned', dispatch: 'D-3', item: 'W-3', at },
    { event: 'dispatched', dispatch: 'D-4', item: 'W-4', branch: 'hitld/D-4', at },
    { event: 'reported', dispatch: 'D-4', item: 'W-4', at },
    // A follow-up of D-5 runs in D-5's worktree, on its branch.
    { event: 'dispatched', dispatch: 'D-5', item: 'W-5', branch: 'hitld/D-5', at },
    { event: 'interrupted', dispatch: 'D-5', item: 'W-5', at },
    { event: 'dispatched', dispatch: 'D-6', item: 'W-5', branch: 'hitld/D-5', at },
  ];
  const leases = [
    lease('D-1'),
    lease('D-2', { adopted: true }),
    lease('D-3'),
    lease('D-4'),
    lease('D-5'),
    lease('D-7', { path: '/repo', adopted: true }),
    lease('D-8', { state: 'failed' }),
    lease('D-9'),
  ];
  const r = teardownPlan({
    leases,
    events: /** @type {any} */ (events),
    merged: (l) => l.holder === 'D-9' || l.holder === 'D-1',
    primary: '/repo',
  });
  assert.deepEqual(
    r.remove.map((x) => [x.holder, x.result]),
    [
      ['D-2', 'merged'],
      ['D-3', 'abandoned'],
      ['D-9', 'merged'],
    ],
  );
  const why = Object.fromEntries(r.keep.map((x) => [x.holder, x.why]));
  assert.match(why['D-1'], /held by D-1/, 'a live dispatch keeps its worktree, merged or not');
  assert.match(why['D-5'], /held by D-6/, 'a follow-up holds the worktree it continues in');
  assert.match(why['D-7'], /primary checkout/);
  assert.match(why['D-8'], /inspection/);
  assert.match(why['D-4'], /not merged/, 'a reported branch waits for its merge');
});

test('the watchdog removes a merged worktree through the manager, keeping primary and live ones', async () => {
  const c = makeConsumer({
    files: {
      'work/items/W-4-redesign.md': item({
        id: 'W-4',
        title: 'Redesign',
        kind: 'work',
        state: 'planned',
        tier_override: '3',
        touches: ['src/new.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  const roomy = machineWith(100_000);
  assert.equal((await hitld(c, ['run', 'start'], roomy)).exit, 0);

  // A live tier-3 dispatch with its worktree from hitld env.
  const live = await hitld(c, ['dispatch', 'start', 'W-4'], roomy);
  assert.equal(live.exit, 0, JSON.stringify(live.result));
  assert.ok(existsSync(live.result.worktree));

  // A finished worktree: its holder's work merged into main.
  const done = await hitld(c, ['env', 'setup', '--dispatch', 'D-90', '--item', 'W-2'], roomy);
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  git(done.result.path, 'commit', '--allow-empty', '-q', '-m', 'work');
  git(c.root, 'merge', '--ff-only', '-q', done.result.branch);

  // A worktree the harness made and the executor adopted, also merged.
  const harnessMade = join(c.base, 'harness-wt');
  git(c.root, 'worktree', 'add', '-q', '-b', 'hitld/W-3-harness', harnessMade);
  const adopted = await hitld(c, ['env', 'setup', '--dispatch', 'D-91', '--adopt', harnessMade]);
  assert.equal(adopted.exit, 0, JSON.stringify(adopted.result));
  git(harnessMade, 'commit', '--allow-empty', '-q', '-m', 'more work');
  git(c.root, 'merge', '--ff-only', '-q', 'hitld/W-3-harness');

  // The primary checkout, adopted as if by mistake: never removed.
  const primary = await hitld(c, ['env', 'setup', '--dispatch', 'D-92', '--adopt', c.root]);
  assert.equal(primary.exit, 0, JSON.stringify(primary.result));

  const watch = await hitld(c, ['dispatch', 'watch'], roomy, { HITLD_SESSION: 'cos' });
  assert.equal(watch.exit, 0, JSON.stringify(watch.result));
  assert.deepEqual(watch.result.worktrees.removed.map((/** @type {any} */ x) => x.holder).sort(), [
    'D-90',
    'D-91',
  ]);
  assert.equal(existsSync(done.result.path), false, 'the merged worktree is gone');
  assert.equal(existsSync(harnessMade), false, 'the merged adopted worktree is gone');
  assert.ok(existsSync(live.result.worktree), 'the live dispatch keeps its worktree');
  assert.ok(existsSync(join(c.root, '.git')), 'the primary checkout stays');

  const status = await hitld(c, ['env', 'status'], roomy);
  assert.deepEqual(status.result.worktrees.map((/** @type {any} */ w) => w.holder).sort(), [
    'D-1',
    'D-92',
  ]);
});
