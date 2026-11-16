// The machine-wide registry (design 13.4, "Across projects"; HITLD-40) and check 11 of "One signal
// end to end" (part 21) on fixture projects: two projects on one machine stay within the person's
// cap together, see the same account usage, and merge without waiting on each other's queue.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { policyDefaults } from '../lib/policy/policy.mjs';
import { dispatchGate } from '../lib/quota/gate.mjs';
import { openEnv, machineRootFor } from '../lib/env/manager.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { settingsLocation } from '../lib/settings/files.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import {
  activeProjects,
  liveExecutors,
  readAccountSnapshots,
  readMachineRegistry,
  reconcileExecutors,
  recordSnapshot,
  registerExecutor,
  releaseExecutor,
  runningElsewhere,
  shareFraction,
} from '../lib/registry/machine.mjs';
import { STATUS_INPUT, git, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const tmp = realpathSync(tempDir('hitld-registry-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const dir = (/** @type {string} */ name) => {
  const d = join(tmp, `${name}-${n++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

const HITLD = resolve(fileURLToPath(new URL('../bin/hitld.mjs', import.meta.url)));
const REGISTRY = resolve(fileURLToPath(new URL('../lib/registry/machine.mjs', import.meta.url)));

const alive = () => ({ live: /** @type {const} */ (true) });
/** @param {string} root @param {string} project @param {string} dispatch */
const entry = (root, project, dispatch) => ({
  project,
  dispatch,
  item: 'W-1',
  store_root: join(root, project),
  resources: [],
});

/** Run a node script as its own process. @param {string[]} args @param {string} cwd @param {NodeJS.ProcessEnv} env */
function node(args, cwd, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
}

test('executors from every project are recorded, counted elsewhere, and released', () => {
  const root = dir('machine');
  assert.equal(
    registerExecutor(root, entry(root, 'alpha', 'D-1'), {}, { liveness: alive }).ok,
    true,
  );
  assert.equal(
    registerExecutor(root, entry(root, 'beta', 'D-1'), {}, { liveness: alive }).ok,
    true,
  );
  assert.equal(
    liveExecutors(root, { liveness: alive }).length,
    2,
    'same dispatch ID, two projects',
  );
  assert.equal(releaseExecutor(root, 'alpha', 'D-1'), true);
  assert.equal(releaseExecutor(root, 'alpha', 'D-1'), false, 'releasing twice is harmless');
  assert.deepEqual(Object.keys(readMachineRegistry(root).executors), ['beta/D-1']);
});

test('registering past the person or machine maximum is refused', () => {
  const root = dir('machine');
  const live = { liveness: alive };
  assert.equal(registerExecutor(root, entry(root, 'a', 'D-1'), { person: 2 }, live).ok, true);
  assert.equal(registerExecutor(root, entry(root, 'b', 'D-1'), { person: 2 }, live).ok, true);
  const refused = registerExecutor(root, entry(root, 'c', 'D-1'), { person: 2, machine: 5 }, live);
  assert.deepEqual(refused, { ok: false, layer: 'person', max: 2, live: 2 });
  const tight = registerExecutor(root, entry(root, 'c', 'D-1'), { person: 9, machine: 2 }, live);
  assert.equal(tight.ok === false && tight.layer, 'machine');
  // Registering the same executor again is not a second slot.
  assert.equal(registerExecutor(root, entry(root, 'a', 'D-1'), { person: 2 }, live).ok, true);
});

test('many processes registering at once never pass the cap or corrupt the file', async () => {
  const root = dir('machine');
  const script = `
    import { registerExecutor } from ${JSON.stringify(pathToFileURL(REGISTRY).href)};
    const [root, project] = process.argv.slice(2);
    const r = registerExecutor(root, { project, dispatch: 'D-1', item: 'W-1', store_root: root, resources: [] },
      { machine: 3 }, { liveness: () => ({ live: true }) });
    console.log(JSON.stringify(r));`;
  const file = join(dir('script'), 'register.mjs');
  writeFileSync(file, script);
  const results = /** @type {{ code: number, out: string }[]} */ (
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        node([file, root, `p${i}`], tmp, { PATH: process.env.PATH }),
      ),
    )
  );
  for (const r of results) assert.equal(r.code, 0, r.out);
  const ok = results.filter((r) => JSON.parse(r.out).ok).length;
  assert.equal(ok, 3, 'exactly the cap');
  const reg = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
  assert.equal(Object.keys(reg.executors).length, 3, 'the file parses and holds what was admitted');
});

test('a dead executor does not hold a slot: process gone, or dispatch gone from its ledger', async () => {
  const root = dir('machine');
  const store = openStore(join(root, 'ghost'));
  // A process that has exited.
  const gone = await new Promise((done) => {
    const c = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    c.on('close', () => done(c.pid));
  });
  reconcileExecutors(root); // nothing yet
  registerExecutor(
    root,
    { ...entry(root, 'ghost', 'D-1'), pid: /** @type {number} */ (gone) },
    {},
    { liveness: alive },
  );
  registerExecutor(root, entry(root, 'ghost', 'D-2'), {}, { liveness: alive });
  registerExecutor(root, entry(root, 'ghost', 'D-3'), {}, { liveness: alive });
  assert.equal(store.read('ledger.jsonl'), null, 'the project has no ledger: nothing is in flight');
  assert.equal(liveExecutors(root).length, 0, 'readers skip every one of them');
  assert.equal(runningElsewhere(root, 'other').person, 0);
  assert.deepEqual(activeProjects(root, 'other'), ['other']);
  // A writer removes them, and a cap of one is free for a real executor.
  const fresh = registerExecutor(root, entry(root, 'real', 'D-1'), { machine: 1 });
  assert.equal(fresh.ok, true);
  assert.deepEqual(fresh.ok && fresh.removed.sort(), ['ghost/D-1', 'ghost/D-2', 'ghost/D-3']);
  const reg = readMachineRegistry(root);
  assert.deepEqual(Object.keys(reg.executors), ['real/D-1'], 'the dead ones were reconciled away');
  const why = reconcileExecutors(root);
  assert.deepEqual(
    why.map((w) => w.key),
    ['real/D-1'],
    'with the real liveness check the stand-in is gone too, and says why',
  );
  assert.match(why[0].why, /no longer has D-1 in flight|ledger/);
});

test('usage snapshots are kept per account, and a limit reads only its own account', () => {
  const root = dir('machine');
  const at = '2026-11-14T12:00:00.000Z';
  const snap = (/** @type {number} */ five) => ({
    schema_version: 1,
    at,
    source: 'claude-code-statusline',
    rate_limits: { five_hour: { used_percentage: five } },
  });
  assert.equal(recordSnapshot(root, 'default', snap(10)), true);
  assert.equal(recordSnapshot(root, 'default', snap(10)), false, 'the same snapshot is kept once');
  recordSnapshot(root, 'work', snap(90));
  const all = readAccountSnapshots(root);
  assert.deepEqual(all.map((s) => s.account).sort(), ['default', 'work']);

  const policy = policyDefaults();
  const gate = dispatchGate(policy, all, {}, { now: Date.parse(at) });
  const five = gate.quotas.find((q) => q.id === 'claude-five-hour');
  assert.equal(five?.used, 10, 'default-account limits read the default account, not work');
});

test('shares near the reserve: a project judges its share of the headroom left', () => {
  const policy = policyDefaults();
  const T0 = Date.parse('2026-11-14T12:00:00Z');
  const snapshot = (/** @type {number} */ five) => ({
    schema_version: 1,
    at: new Date(T0).toISOString(),
    source: 'claude-code-statusline',
    rate_limits: {
      five_hour: { used_percentage: five, resets_at: Math.floor((T0 + 3 * 3600e3) / 1000) },
      seven_day: { used_percentage: 5, resets_at: Math.floor((T0 + 3 * 86400e3) / 1000) },
    },
  });
  const person = { projects: { big: { share: 3 }, small: { share: 1 } } };
  const active = ['big', 'small'];
  assert.equal(shareFraction(person, 'big', active), 0.75);
  assert.equal(shareFraction(person, 'small', active), 0.25);
  assert.equal(shareFraction(null, 'x', ['x', 'y']), 0.5, 'equal by default');
  assert.equal(shareFraction(person, 'big', ['big']), 1, 'alone, it has all of it');

  // 25% of the limit above the reserve: economize for a project with all of it.
  const s = [snapshot(50)];
  const opt = { now: T0 };
  assert.equal(dispatchGate(policy, s, {}, { ...opt, share: 1 }).mode, 'economize');
  assert.equal(
    dispatchGate(policy, s, {}, { ...opt, share: shareFraction(person, 'big', active) }).mode,
    'economize',
    'the big share still has more than the critical threshold of what is left',
  );
  const small = dispatchGate(
    policy,
    s,
    {},
    { ...opt, share: shareFraction(person, 'small', active) },
  );
  assert.equal(small.mode, 'critical_path_only', 'the small share is held to the critical path');
  assert.match(small.reason, /share of 25% left/);
  // Ample headroom is nobody's competition, and a stop stays a stop.
  assert.equal(dispatchGate(policy, [snapshot(10)], {}, { ...opt, share: 0.25 }).mode, 'normal');
  assert.equal(dispatchGate(policy, [snapshot(80)], {}, { ...opt, share: 0.25 }).mode, 'stop');
});

test('the merge queue lock is per repository; other locks stay machine-wide', async () => {
  const a = makeConsumer();
  const b = makeConsumer({ policy: { project: { id: 'beta', key: 'W' } } });
  const machineRoot = dir('machine');
  /** @param {ReturnType<typeof makeConsumer>} c */
  const open = (c) => {
    const store = openStore(privateStorePath('x', { env: c.env }));
    return openEnv({
      repoRoot: c.root,
      store,
      machineRoot,
      env: c.env,
      policy: { project: { id: 'x', key: 'W' }, env: {} },
    });
  };
  const ea = open(a);
  const eb = open(b);
  const first = await ea.acquireLock({ resource: 'merge-queue', holder: 'merge-queue' });
  assert.equal(first.acquired, true);
  const other = await eb.acquireLock({ resource: 'merge-queue', holder: 'merge-queue' });
  assert.equal(other.acquired, true, "another repository's queue is not waiting on it");
  const again = await open(a).acquireLock({ resource: 'merge-queue', holder: 'merge-queue-2' });
  assert.equal(again.acquired, false, 'the same repository still serializes its own merges');
  assert.equal(again.acquired === false && again.held_by?.holder, 'merge-queue');
  // The report says merge-queue for both, held in each.
  const held = (/** @type {ReturnType<typeof open>} */ e) =>
    e.lockStatus().find((l) => l.resource === 'merge-queue')?.held_by;
  assert.equal(held(ea), 'merge-queue');
  assert.equal(held(eb), 'merge-queue');
  // A serial resource that is not per repository stays shared across them.
  const gpu = await ea.acquireLock({ resource: 'gpu', holder: 'D-1' });
  assert.equal(gpu.acquired, true);
  const gpuB = await eb.acquireLock({ resource: 'gpu', holder: 'D-2' });
  assert.equal(gpuB.acquired, false, 'the GPU is one machine resource');
  if (first.acquired) first.handle.release();
  if (other.acquired) other.handle.release();
  if (gpu.acquired) gpu.handle.release();
});

test('the registry lives beside the stores, never inside one, so no export reaches it', () => {
  const store = openStore(privateStorePath('alpha', { env: { XDG_DATA_HOME: tmp } }));
  const root = machineRootFor(store.root);
  recordSnapshot(root, 'default', {
    schema_version: 1,
    at: '2026-11-14T12:00:00.000Z',
    source: 'claude-code-statusline',
  });
  assert.ok(!root.startsWith(store.root + sep), 'not under the project store');
  assert.deepEqual(store.list(), [], 'the store holds none of it');
});

// --- Check 11: two fixture projects on one machine -----------------------------------------------

test('check 11: two projects stay within the person cap, see the same usage, and free slots on completion', async () => {
  const a = makeConsumer();
  const b = makeConsumer({ policy: { project: { id: 'beta', key: 'W' } } });
  // One machine: both projects share the data and config directories.
  const env = { ...a.env };
  const A = (/** @type {string[]} */ argv) => a.hitld(argv, { env });
  const B = (/** @type {string[]} */ argv) => b.hitld(argv, { env });
  assert.notEqual(a.root, b.root);

  const person = settingsLocation('person', { env });
  mkdirSync(person.dir, { recursive: true });
  writeFileSync(person.path, JSON.stringify({ schema_version: 1, max_executors: 2 }), {
    mode: 0o600,
  });

  assert.equal((await A(['run', 'start'])).exit, 0);
  assert.equal((await B(['run', 'start'])).exit, 0);

  // No reading anywhere: both are stopped at the gate.
  assert.equal((await B(['dispatch', 'plan'])).result.start.length, 0);

  // One project's status line records usage; the other sees it.
  assert.equal(recordStatusLine(STATUS_INPUT(a.root), { cwd: a.root, env }).recorded, true);
  const seen = await B(['quota', 'status']);
  assert.equal(seen.exit, 0, JSON.stringify(seen.result));
  const used = JSON.stringify(seen.result);
  assert.match(used, /claude-five-hour/);
  assert.ok(!/no snapshot yet/.test(used), 'beta has a reading it never recorded');
  const planB0 = await B(['dispatch', 'plan']);
  assert.ok(planB0.result.start.length > 0, 'and its gate passes on it');
  assert.equal(planB0.result.cap, 2);

  // A starts one executor: B has one slot left under the person's cap of two.
  const startA = await A(['dispatch', 'start', 'W-1']);
  assert.equal(startA.exit, 0, JSON.stringify(startA.result));
  const planB = await B(['dispatch', 'plan']);
  assert.equal(planB.result.cap, 1, 'the person cap less the one running in alpha');
  assert.equal(planB.result.start.length, 1);
  const startB = await B(['dispatch', 'start', 'W-1']);
  assert.equal(startB.exit, 0, JSON.stringify(startB.result));

  // The cap is spent across the two: neither project can dispatch another.
  const planA = await A(['dispatch', 'plan']);
  assert.equal(planA.result.cap, 1);
  assert.equal(planA.result.start.length, 0);
  const startA2 = await A(['dispatch', 'start', 'W-2']);
  assert.equal(startA2.exit === 0, false);
  assert.equal(startA2.result.error, 'not-planned');
  const live = liveExecutors(machineRootFor(openStore(privateStorePath('x', { env })).root));
  assert.deepEqual(live.map((e) => `${e.project}/${e.dispatch}`).sort(), [
    'beta/D-1',
    'orch-fixture/D-1',
  ]);

  // A's executor reports done: its slot is free for either project.
  const branch = startA.result.branch;
  git(a.root, 'switch', '-q', '-c', branch);
  put(a.root, {
    'work/items/W-1-add-numbers.md': item({
      id: 'W-1',
      title: 'Add numbers',
      kind: 'work',
      state: 'done',
      priority: 'medium',
      touches: ['src/calc.js'],
    }),
  });
  git(a.root, 'commit', '-q', '-am', 'W-1');
  const sha = git(a.root, 'rev-parse', 'HEAD');
  git(a.root, 'switch', '-q', 'main');
  const note = join(a.base, 'note.txt');
  writeFileSync(note, report({ item: 'W-1', sha, branch }));
  const done = await A(['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note]);
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  const after = await B(['dispatch', 'plan']);
  assert.equal(after.result.cap, 2, 'beta sees alpha release its slot');
  assert.deepEqual(
    liveExecutors(machineRootFor(openStore(privateStorePath('x', { env })).root)).map(
      (e) => e.project,
    ),
    ['beta'],
  );
});

test('check 11: two projects dispatching at the same moment cannot pass the cap together', async () => {
  const a = makeConsumer();
  const b = makeConsumer({ policy: { project: { id: 'beta', key: 'W' } } });
  const env = { ...a.env };
  const person = settingsLocation('person', { env });
  mkdirSync(person.dir, { recursive: true });
  writeFileSync(person.path, JSON.stringify({ schema_version: 1, max_executors: 1 }), {
    mode: 0o600,
  });
  for (const c of [a, b]) assert.equal((await c.hitld(['run', 'start'], { env })).exit, 0);
  recordStatusLine(STATUS_INPUT(a.root), { cwd: a.root, env });
  // Both plan against an empty registry, so both are allowed one slot.
  for (const c of [a, b])
    assert.equal((await c.hitld(['dispatch', 'plan'], { env })).result.cap, 1);

  const run = (/** @type {string} */ cwd) =>
    node([HITLD, 'dispatch', 'start', 'W-1'], cwd, {
      ...env,
      HITLD_SESSION: 'test-session',
      PATH: process.env.PATH,
    });
  const [ra, rb] = /** @type {{ out: string }[]} */ (await Promise.all([run(a.root), run(b.root)]));
  const results = [JSON.parse(ra.out), JSON.parse(rb.out)];
  assert.equal(results.filter((r) => r.ok).length, 1, 'one dispatch went');
  const refused = results.find((r) => !r.ok);
  // Which check refuses depends on timing: the plan sees the other's executor if it registered
  // first (not-planned), and the registry's own check catches the case where both had planned.
  assert.ok(['cap', 'not-planned'].includes(refused.error), refused.error);
  assert.equal(
    Object.keys(
      readMachineRegistry(machineRootFor(openStore(privateStorePath('x', { env })).root)).executors,
    ).length,
    1,
  );
});
