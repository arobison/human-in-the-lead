// Store sync in the run commands and the hooks (HITLD-106, design 0003 section 8): run start and
// resume pull, checkpoints, hand-over and merges push, and the SessionStart and SessionEnd hooks
// do the same for a session that dies between them. Two sessions are two private stores on two
// devices, with a bare repository standing in for the store's host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, EXIT } from '../lib/cli/main.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { LEDGER_KEY, appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { ledgerKeys } from '../lib/ledger/writer.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { VERSION } from '../lib/version.mjs';
import { bumpVersion } from '../lib/release/semver.mjs';
import { generateIdentity } from '../lib/store/age.mjs';
import { createGitRemote } from '../lib/store/remote-git.mjs';
import { approve, removeApproved } from './helpers/devices.mjs';
import { loadState } from '../lib/run/checkpoint.mjs';
import { readTrustEvents, recordTrustEvent } from '../lib/rights/trust.mjs';
import {
  autoPull,
  autoPush,
  contextFromCwd,
  hookSync,
  pushingAfter,
} from '../lib/store/auto-sync.mjs';
import { commitAll, fixtureGit, putFiles } from '../lib/eval/orchestrator-fixtures.mjs';
import { tempDir } from './helpers/tmp.mjs';

const DEVICE_A = generateIdentity();
const DEVICE_B = generateIdentity();
const STRANGER = generateIdentity();
const HOOK = fileURLToPath(new URL('../harness/claude-code/hooks/store-sync.mjs', import.meta.url));
const at = (/** @type {number} */ n) => `2026-11-14T10:${String(n).padStart(2, '0')}:00.000Z`;

/**
 * A project checkout with an origin; and a bare repository standing in for the store's host. The
 * owner has approved devices A and B: the first session's store holds those answers, and the
 * others learn them when they pull. Each session gets the host's address in HITLD_STORE_REMOTE,
 * as a cloud environment does; `remote` false gives it none.
 * @param {{ remote?: boolean, onlyA?: boolean }} [o] onlyA: the owner approved device A and no other
 */
function fixture(o = {}) {
  const dir = tempDir('hitld-auto-sync-');
  const project = join(dir, 'project');
  mkdirSync(project);
  fixtureGit(project, 'init', '-q', '-b', 'main');
  fixtureGit(project, 'config', 'user.name', 'Fixture');
  fixtureGit(project, 'config', 'user.email', 'fixture@example.invalid');
  fixtureGit(project, 'config', 'commit.gpgsign', 'false');
  const bare = join(dir, 'host', 'store.git');
  mkdirSync(bare, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', '--bare'], { cwd: bare }).status, 0);
  const url = `file://${bare}`;
  putFiles(project, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
      ...(o.remote === false ? {} : { store: { remote: { required: true } } }),
    }),
  });
  commitAll(project, 'start');
  const origin = join(dir, 'origin.git');
  fixtureGit(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  fixtureGit(project, 'remote', 'add', 'origin', origin);
  fixtureGit(project, 'push', '-q', 'origin', 'main');
  /** @type {[string, { recipient: string }][]} */
  const approved = [['device-a', DEVICE_A]];
  if (!o.onlyA) approved.push(['device-b', DEVICE_B]);
  return { dir, project, bare, url, remote: o.remote !== false, approved, seeded: false };
}

/**
 * One session: its own private store (a data directory of its own) and the commands run as it.
 * The fixture's first session holds the owner's approvals (`seed` says otherwise).
 * @param {ReturnType<typeof fixture>} f @param {string} name
 * @param {{ identity?: string, env?: NodeJS.ProcessEnv, seed?: boolean }} [o]
 */
function session(f, name, o = {}) {
  const data = join(f.dir, 'data', name);
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    PATH: process.env.PATH,
    HOME: join(f.dir, 'home', name),
    XDG_DATA_HOME: data,
    XDG_CONFIG_HOME: join(f.dir, 'config', name),
    ...(f.remote ? { HITLD_STORE_REMOTE: f.url } : {}),
    ...(o.identity ? { HITLD_STORE_IDENTITY: o.identity } : {}),
    ...o.env,
  };
  const store = openStore(privateStorePath('fixture', { env }));
  if (o.seed ?? !f.seeded) {
    approve(store, ...f.approved);
    f.seeded = true;
  }
  /** @param {string[]} argv @param {NodeJS.ProcessEnv} [more] */
  const hitld = async (argv, more = {}) => {
    let out = '';
    const code = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: f.project,
      env: { ...env, ...more },
    });
    return { code, json: JSON.parse(out) };
  };
  return { store, env, hitld, data };
}

/** @param {ReturnType<typeof session>} s @param {string} id @param {number} n */
const ask = (s, id, n) =>
  appendEvent(s.store, { event: 'asked', decision: `W-${n}`, id, at: at(n) });

/** The head of the host's store branch: null when nothing was ever pushed. @param {ReturnType<typeof fixture>} f */
const remoteHead = (f) => createGitRemote({ url: f.url, dir: join(f.dir, 'peek') }).head();

test('without a remote nothing is pulled or pushed, and the results say nothing about it', async () => {
  const f = fixture({ remote: false });
  const s = session(f, 's1', { identity: DEVICE_A.identity });
  const started = await s.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  assert.equal('store_sync' in started.json, false);
  const cp = await s.hitld(['run', 'checkpoint', '--session', 's-1', '--host', 'h']);
  assert.equal(cp.code, EXIT.ok);
  assert.equal('store_sync' in cp.json, false);
  const handover = await s.hitld(['handover', '--session', 's-1', '--host', 'h']);
  assert.equal(handover.json.ok, true, JSON.stringify(handover.json));
  assert.equal('store_sync' in handover.json, false);
  assert.equal(await remoteHead(f), null);
});

test('milestone c1: a run discarded after a checkpoint resumes in a new session, intact', async () => {
  const f = fixture();
  const one = session(f, 'one', { identity: DEVICE_A.identity });
  const started = await one.hitld(['run', 'start', '--session', 's-1', '--host', 'example-host-1']);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  // A fresh remote is empty: the pull says so.
  assert.deepEqual(
    [started.json.store_sync.pull.status, started.json.store_sync.pull.result],
    ['done', 'empty'],
  );
  ask(one, 'E-1', 1);
  ask(one, 'E-2', 2);
  recordTrustEvent(
    one.store,
    { kind: 'reversal', area: 'api', subject: 'E-1', subject_kind: 'logged-call' },
    at(3),
  );
  const cp = await one.hitld(['run', 'checkpoint', '--session', 's-1', '--host', 'example-host-1']);
  assert.equal(cp.code, EXIT.ok, JSON.stringify(cp.json));
  assert.deepEqual(
    [cp.json.store_sync.push.status, cp.json.store_sync.push.result],
    ['done', 'pushed'],
  );
  const runId = started.json.run.id;
  const ledgerBefore = readLedger(one.store).events;
  const trustBefore = readTrustEvents(one.store);

  // The container is discarded: nothing of the first session's store is left.
  rmSync(one.data, { recursive: true, force: true });

  // A new session, on another device with a key of its own, resumes the run.
  const two = session(f, 'two', { identity: DEVICE_B.identity });
  assert.equal(existsSync(two.store.root), false);
  const resumed = await two.hitld([
    'run',
    'resume',
    '--session',
    's-2',
    '--host',
    'example-host-2',
    '--force',
  ]);
  assert.equal(resumed.code, EXIT.ok, JSON.stringify(resumed.json));
  assert.equal(resumed.json.store_sync.pull.status, 'done');
  assert.equal(resumed.json.store_sync.rebuilt_state, true);
  assert.equal(resumed.json.handover.run, runId);
  assert.equal(resumed.json.handover.lease.session, 's-2');
  assert.deepEqual(
    resumed.json.handover.decisions_open.map((/** @type {any} */ q) => q.decision),
    ['W-1', 'W-2'],
  );
  // The ledger (plus the takeover the resume itself recorded) and the trust record are all there.
  const ledgerAfter = readLedger(two.store).events;
  assert.deepEqual(ledgerAfter.slice(0, ledgerBefore.length), ledgerBefore);
  assert.equal(ledgerAfter.at(-1)?.event, 'lease-taken');
  assert.deepEqual(readTrustEvents(two.store), trustBefore);
  assert.equal(loadState(two.store).state?.run.id, runId);
});

test('a hand-over pushes after the lease is released, so a successor takes it without force', async () => {
  const f = fixture();
  const one = session(f, 'one', { identity: DEVICE_A.identity });
  await one.hitld(['run', 'start', '--session', 's-1', '--host', 'example-host-1']);
  ask(one, 'E-1', 1);
  const handed = await one.hitld(['handover', '--session', 's-1', '--host', 'example-host-1']);
  assert.equal(handed.json.ok, true, JSON.stringify(handed.json));
  assert.equal(handed.json.store_sync.push.status, 'done');
  assert.ok(handed.json.released);

  const two = session(f, 'two', { identity: DEVICE_B.identity });
  const resumed = await two.hitld([
    'run',
    'resume',
    '--session',
    's-2',
    '--host',
    'example-host-2',
  ]);
  assert.equal(resumed.code, EXIT.ok, JSON.stringify(resumed.json));
  assert.equal(resumed.json.took_over.reason, 'handover');
  // The hand-over note traveled with the store.
  assert.ok(two.store.list('orchestrator/').some((k) => k.startsWith('orchestrator/handover-')));
});

test('a merge pushes once it has run; a refused one pushes nothing', async () => {
  const f = fixture();
  const one = session(f, 'one', { identity: DEVICE_A.identity });
  const refused = await one.hitld(['merge', '--session', 's-1', '--host', 'h']);
  assert.equal(refused.json.error, 'no-run');
  assert.equal('store_sync' in refused.json, false);
  assert.equal(await remoteHead(f), null);

  await one.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
  const merged = await one.hitld(['merge', '--session', 's-1', '--host', 'h']);
  assert.equal(merged.json.ok, true, JSON.stringify(merged.json));
  assert.equal(merged.json.store_sync.push.status, 'done');
  assert.notEqual(await remoteHead(f), null);
});

test('pushingAfter pushes a command that succeeded and leaves a refusal alone', async () => {
  const f = fixture();
  const s = session(f, 's', { identity: DEVICE_A.identity });
  ask(s, 'E-1', 1);
  /** @type {import('../lib/cli/table.mjs').Command[]} */
  const table = [
    { name: 'a', summary: '', built_by: 'h', args: [], run: async () => ({ ok: true }) },
    {
      name: 'b',
      summary: '',
      built_by: 'h',
      args: [],
      run: async () => ({ ok: false, error: 'x' }),
    },
    { name: 'c', summary: '', built_by: 'h', args: [], run: async () => ({ ok: true }) },
  ];
  const [a, b, c] = pushingAfter(table, ['a', 'b']);
  const ctx = { cwd: f.project, env: s.env, out: () => {}, err: () => {} };
  const refused = /** @type {any} */ (await b.run?.({}, /** @type {any} */ (ctx)));
  assert.equal(refused.store_sync, undefined);
  assert.equal(await remoteHead(f), null);
  const pushed = /** @type {any} */ (await a.run?.({}, /** @type {any} */ (ctx)));
  assert.equal(pushed.store_sync.push.result, 'pushed');
  assert.equal(c.run, table[2].run);
});

test('a remote that cannot be reached: start and resume go on, a push is reported', async () => {
  const f = fixture();
  const s = session(f, 's1', { identity: DEVICE_A.identity });
  rmSync(f.bare, { recursive: true, force: true });
  const started = await s.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  assert.equal(started.json.store_sync.pull.status, 'unreachable');
  assert.ok(started.json.store_sync.pull.error.code);
  const cp = await s.hitld(['run', 'checkpoint', '--session', 's-1', '--host', 'h']);
  assert.equal(cp.code, EXIT.ok, JSON.stringify(cp.json));
  assert.equal(cp.json.store_sync.push.status, 'unreachable');
  assert.match(cp.json.store_sync.push.line, /could not be reached/);
  const resumed = await s.hitld(['run', 'resume', '--session', 's-1', '--host', 'h']);
  assert.equal(resumed.code, EXIT.ok, JSON.stringify(resumed.json));
  assert.equal(resumed.json.store_sync.pull.status, 'unreachable');
});

test('run start names the cause of an unreachable remote and what fixes it', async () => {
  const f = fixture();
  // A local repository that is not there: the host answered, and there is no such repository.
  const gone = session(f, 'gone', { identity: DEVICE_A.identity });
  rmSync(f.bare, { recursive: true, force: true });
  const started = await gone.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  const pull = started.json.store_sync.pull;
  assert.equal(pull.status, 'unreachable');
  assert.deepEqual(
    pull.causes.map((/** @type {any} */ c) => c.cause),
    ['repository-not-found'],
  );
  assert.ok(pull.causes[0].fix);
  assert.match(pull.line, /could not be reached \(repository-not-found\).*To fix: /);
  // A cloud session does not take a local repository for one it has not attached.
  const cloud = await gone.hitld(['run', 'resume', '--session', 's-1', '--host', 'h'], {
    CLAUDE_CODE_REMOTE: 'true',
  });
  assert.equal(cloud.json.store_sync.pull.causes[0].cause, 'repository-not-found');

  // A host that does not answer, in a fresh container whose copy of the store holds no approvals:
  // the device's own enrollment is not known until a pull.
  const fresh = session(f, 'fresh', {
    identity: DEVICE_B.identity,
    seed: false,
    env: { HITLD_STORE_REMOTE: 'https://127.0.0.1:9/owner/store.git' },
  });
  const down = await fresh.hitld(['run', 'start', '--session', 's-2', '--host', 'h'], {
    CLAUDE_CODE_REMOTE: 'true',
  });
  assert.equal(down.code, EXIT.ok, JSON.stringify(down.json));
  assert.deepEqual(
    down.json.store_sync.pull.causes.map((/** @type {any} */ c) => c.cause),
    ['host-unreachable', 'device-not-pulled'],
  );
  // The causes name the store by its role; git's words, with the address, stay in `error`.
  assert.doesNotMatch(JSON.stringify(down.json.store_sync.pull.causes), /127\.0\.0\.1/);
});

test('run start without a device key names it as the cause', async () => {
  const f = fixture();
  const s = session(f, 's1');
  const started = await s.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  assert.equal(started.json.store_sync.pull.reason, 'no-identity');
  assert.equal(started.json.store_sync.pull.causes[0].cause, 'device-no-key');
});

test('store status says whether the store syncs here, and each cause when it does not', async () => {
  const f = fixture();
  const one = session(f, 'one', { identity: DEVICE_A.identity });
  await one.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
  await one.hitld(['run', 'checkpoint', '--session', 's-1', '--host', 'h']);
  const ok = await one.hitld(['store', 'status']);
  assert.equal(ok.code, EXIT.ok, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.sync, { ready: true, local_only: false, causes: [] });

  const stranger = session(f, 'stranger', { identity: STRANGER.identity, seed: false });
  const locked = await stranger.hitld(['store', 'status']);
  assert.equal(locked.json.sync.ready, false);
  assert.deepEqual(
    locked.json.sync.causes.map((/** @type {any} */ c) => c.cause),
    ['device-not-enrolled'],
  );

  rmSync(f.bare, { recursive: true, force: true });
  const fresh = session(f, 'fresh', { identity: DEVICE_B.identity, seed: false });
  const down = await fresh.hitld(['store', 'status']);
  assert.equal(down.json.sync.ready, false);
  assert.deepEqual(
    down.json.sync.causes.map((/** @type {any} */ c) => c.cause),
    ['repository-not-found', 'device-not-pulled'],
  );
});

test('a reachable remote whose head does not open stops run start; --no-sync goes on', async () => {
  const f = fixture();
  const one = session(f, 'one', { identity: DEVICE_A.identity });
  await one.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
  await one.hitld(['run', 'checkpoint', '--session', 's-1', '--host', 'h']);

  // A device with a key that is not on main's list cannot open what the remote holds.
  const other = session(f, 'other', { identity: STRANGER.identity });
  const refused = await other.hitld(['run', 'start', '--session', 's-9', '--host', 'h']);
  assert.equal(refused.code, EXIT.failed);
  assert.equal(refused.json.error, 'store-pull-refused');
  assert.equal(refused.json.cause.code, 'age-no-match');
  assert.equal(refused.json.store_sync.pull.causes[0].cause, 'device-not-enrolled');
  assert.match(refused.json.message, /device-not-enrolled: /);
  assert.equal(refused.json.store_sync.pull.status, 'failed');
  assert.equal(loadState(other.store).state, null, 'nothing was started');
  const refusedResume = await other.hitld(['run', 'resume', '--session', 's-9', '--host', 'h']);
  assert.equal(refusedResume.json.error, 'store-pull-refused');

  const forced = await other.hitld([
    'run',
    'start',
    '--session',
    's-9',
    '--host',
    'h',
    '--no-sync',
  ]);
  assert.equal(forced.code, EXIT.ok, JSON.stringify(forced.json));
  assert.equal(forced.json.store_sync.pull.reason, 'no-sync');
  // Its push is refused, and said so, without failing the checkpoint.
  const cp = await other.hitld(['run', 'checkpoint', '--session', 's-9', '--host', 'h']);
  assert.equal(cp.code, EXIT.ok);
  assert.equal(cp.json.store_sync.push.status, 'failed');
  assert.equal(cp.json.store_sync.push.error.code, 'device-not-enrolled');
});

test('a device with no key skips the sync without an error', async () => {
  const f = fixture();
  const s = session(f, 'nokey');
  const started = await s.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  assert.equal(started.json.store_sync.pull.status, 'skipped');
  assert.equal(started.json.store_sync.pull.reason, 'no-identity');
  assert.equal(await remoteHead(f), null);
});

for (const where of /** @type {const} */ (['person', 'machine'])) {
  test(`an address in the ${where === 'person' ? 'person file' : "machine's override"} is synced too`, async () => {
    const f = fixture({ remote: false });
    const s = session(f, 's', { identity: DEVICE_A.identity });
    const set = await s.hitld([
      'store',
      'remote',
      'set',
      f.url,
      ...(where === 'machine' ? ['--machine'] : []),
    ]);
    assert.equal(set.code, EXIT.ok, JSON.stringify(set.json));
    assert.equal(set.json.written, where);
    await s.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
    const cp = await s.hitld(['run', 'checkpoint', '--session', 's-1', '--host', 'h']);
    assert.equal(cp.json.store_sync.push.result, 'pushed', JSON.stringify(cp.json.store_sync));
    assert.equal(cp.json.store_sync.push.remote.source, where);
  });
}

test('store.remote.required with no address: run start, status and the hooks say so, nothing stops', async () => {
  const f = fixture();
  const s = session(f, 's', { identity: DEVICE_A.identity });
  const env = { ...s.env };
  delete env.HITLD_STORE_REMOTE;
  const started = await s.hitld(['run', 'start', '--session', 's-1', '--host', 'h'], {
    HITLD_STORE_REMOTE: '',
  });
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  assert.deepEqual(
    [started.json.store_sync.pull.status, started.json.store_sync.pull.reason],
    ['skipped', 'remote-required'],
  );
  assert.match(started.json.store_sync.pull.line, /HITLD_STORE_REMOTE/);
  assert.match(started.json.store_sync.pull.line, /hitld store remote set/);
  const status = await s.hitld(['store', 'status'], { HITLD_STORE_REMOTE: '' });
  assert.equal(status.json.remote, null);
  assert.equal(status.json.remote_required, true);
  assert.match(status.json.problems[0], /HITLD_STORE_REMOTE/);
  for (const action of ['pull', 'push']) {
    const r = spawnSync('node', [HOOK, action], {
      input: JSON.stringify({ cwd: f.project }),
      env,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.match(r.stdout, /store\.remote\.required is true/);
  }
});

test('executors never sync: the module and the hooks skip them', async () => {
  const f = fixture();
  const s = session(f, 'exec', { identity: DEVICE_A.identity });
  ask(s, 'E-1', 1);
  for (const extra of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-3' }]) {
    const env = { ...s.env, ...extra };
    const c = /** @type {NonNullable<ReturnType<typeof contextFromCwd>>} */ (
      contextFromCwd(f.project, env)
    );
    for (const run of [autoPull, autoPush]) {
      const r = await run(c);
      assert.deepEqual([r.status, r.reason], ['skipped', 'executor']);
    }
    assert.equal(await hookSync('push', { cwd: f.project, env }), null);
    const hook = spawnSync('node', [HOOK, 'push'], {
      input: '{}',
      env,
      cwd: f.project,
      encoding: 'utf8',
    });
    assert.deepEqual([hook.status, hook.stdout], [0, '']);
  }
  // A hook input that names an executor agent is skipped as well.
  const hook = spawnSync('node', [HOOK, 'push'], {
    input: JSON.stringify({ cwd: f.project, agent_type: 'human-in-the-lead:executor' }),
    env: s.env,
    encoding: 'utf8',
  });
  assert.deepEqual([hook.status, hook.stdout], [0, '']);
  assert.equal(await remoteHead(f), null);
});

test('the hooks: SessionEnd pushes, SessionStart pulls, each prints one line and exits 0', async () => {
  const f = fixture();
  const one = session(f, 'one', { identity: DEVICE_A.identity });
  ask(one, 'E-1', 1);
  /** @param {ReturnType<typeof session>} s @param {string} action */
  const hook = (s, action) =>
    spawnSync('node', [HOOK, action], {
      input: JSON.stringify({
        cwd: f.project,
        hook_event_name: action === 'pull' ? 'SessionStart' : 'SessionEnd',
      }),
      env: s.env,
      encoding: 'utf8',
    });
  const end = hook(one, 'push');
  assert.equal(end.status, 0, end.stderr);
  assert.equal(end.stdout.trim().split('\n').length, 1);
  assert.match(end.stdout, /^store push: pushed/);
  assert.notEqual(await remoteHead(f), null);

  const two = session(f, 'two', { identity: DEVICE_B.identity });
  const start = hook(two, 'pull');
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /^store pull: merged the remote/);
  assert.equal(readLedger(two.store).events.length, 1);

  // No network: reported, exit 0.
  rmSync(f.bare, { recursive: true, force: true });
  const down = hook(two, 'push');
  assert.equal(down.status, 0);
  assert.match(down.stdout, /could not be reached/);
});

test('a project with no remote: the hooks print nothing and exit 0', () => {
  const f = fixture({ remote: false });
  const s = session(f, 's', { identity: DEVICE_A.identity });
  for (const action of ['pull', 'push']) {
    const r = spawnSync('node', [HOOK, action], {
      input: JSON.stringify({ cwd: f.project }),
      env: s.env,
      encoding: 'utf8',
    });
    assert.deepEqual([r.status, r.stdout], [0, '']);
  }
});

test('the plugin carries the two hooks, and install says so', async () => {
  const hooks = JSON.parse(
    readFileSync(new URL('../harness/claude-code/hooks/hooks.json', import.meta.url), 'utf8'),
  ).hooks;
  /** @param {string} event @param {string} word */
  const runs = (event, word) =>
    hooks[event]
      .flatMap((/** @type {any} */ g) => g.hooks)
      .some((/** @type {any} */ h) => h.command.includes('store-sync.mjs" ' + word));
  assert.equal(runs('SessionStart', 'pull'), true);
  assert.equal(runs('SessionEnd', 'push'), true);
  // The default SessionEnd budget is 1.5 seconds; a push needs the longer one the hook asks for.
  for (const event of ['SessionStart', 'SessionEnd']) {
    const h = hooks[event]
      .flatMap((/** @type {any} */ g) => g.hooks)
      .find((/** @type {any} */ x) => x.command.includes('store-sync.mjs'));
    assert.ok(h.timeout >= 30);
  }
  const f = fixture({ remote: false });
  const s = session(f, 's');
  const r = await s.hitld(['install']);
  assert.equal(r.code, EXIT.ok, JSON.stringify(r.json));
  assert.match(r.json.done.store_sync_hooks, /SessionStart pulls/);
});

test('autoPull and autoPush: a conflict is a failure that names the paths, nothing is merged', async () => {
  const f = fixture();
  const a = session(f, 'a', { identity: DEVICE_A.identity });
  const b = session(f, 'b', { identity: DEVICE_B.identity });
  a.store.write('notes/n.md', 'one\n');
  const ca = /** @type {NonNullable<ReturnType<typeof contextFromCwd>>} */ (
    contextFromCwd(f.project, a.env)
  );
  assert.equal((await autoPush(ca)).result, 'pushed');
  const cb = /** @type {NonNullable<ReturnType<typeof contextFromCwd>>} */ (
    contextFromCwd(f.project, b.env)
  );
  b.store.write('notes/n.md', 'two\n');
  b.store.write('notes/other.md', 'x\n');
  // b has history of its own, so its pull has to merge: the same file changed both ways.
  const pulled = await autoPull(cb);
  assert.equal(pulled.status, 'failed');
  assert.equal(pulled.error?.code, 'conflict');
  assert.ok(pulled.error?.conflicts);
  assert.equal(b.store.read('notes/n.md'), 'two\n');
});

test('lease is the lock: a pulled lease another machine holds is refused until it is released', async () => {
  const f = fixture();
  const a = session(f, 'a', { identity: DEVICE_A.identity });
  const b = session(f, 'b', { identity: DEVICE_B.identity });
  await a.hitld(['run', 'start', '--session', 's-A', '--host', 'example-host-1']);
  const cp = await a.hitld(['run', 'checkpoint', '--session', 's-A', '--host', 'example-host-1']);
  assert.equal(cp.json.store_sync.push.status, 'done');

  // Machine B pulls and cannot start or resume: A holds the lease and never released it.
  const refused = await b.hitld(['run', 'start', '--session', 's-B', '--host', 'example-host-2']);
  assert.equal(refused.code, EXIT.failed);
  assert.equal(refused.json.error, 'lease-held');
  assert.equal(refused.json.holder.session, 's-A');
  assert.equal(refused.json.holder.host, 'example-host-1');
  assert.match(refused.json.message, /s-A on example-host-1 at 20/);
  assert.match(refused.json.message, /hitld run retire --holder s-A/);
  assert.match(refused.json.message, /--replace/);
  const refusedResume = await b.hitld([
    'run',
    'resume',
    '--session',
    's-B',
    '--host',
    'example-host-2',
  ]);
  assert.equal(refusedResume.json.error, 'lease-held');
  assert.match(refusedResume.json.message, /--force/);
  // Nothing was taken or started, but the state is there for retire to work on.
  assert.equal(loadState(b.store).state?.lease.session, 's-A');

  // The same machine's own lease is judged as before: A resumes its own run.
  const again = await a.hitld(['run', 'resume', '--session', 's-A', '--host', 'example-host-1']);
  assert.equal(again.code, EXIT.ok, JSON.stringify(again.json));

  // The owner's retire (A's session is known dead) releases it, and B starts.
  const retired = await b.hitld([
    'run',
    'retire',
    '--holder',
    's-A',
    '--session',
    's-B',
    '--host',
    'example-host-2',
  ]);
  assert.equal(retired.code, EXIT.ok, JSON.stringify(retired.json));
  assert.equal(retired.json.store_sync.push.status, 'done');
  const started = await b.hitld(['run', 'start', '--session', 's-B', '--host', 'example-host-2']);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  assert.equal(started.json.handover.lease.session, 's-B');
});

test('lease is the lock: after the holder hands over, another machine starts without force', async () => {
  const f = fixture();
  const a = session(f, 'a', { identity: DEVICE_A.identity });
  const b = session(f, 'b', { identity: DEVICE_B.identity });
  await a.hitld(['run', 'start', '--session', 's-A', '--host', 'example-host-1']);
  await a.hitld(['run', 'checkpoint', '--session', 's-A', '--host', 'example-host-1']);
  const refused = await b.hitld(['run', 'start', '--session', 's-B', '--host', 'example-host-2']);
  assert.equal(refused.json.error, 'lease-held');

  const handed = await a.hitld(['handover', '--session', 's-A', '--host', 'example-host-1']);
  assert.equal(handed.json.store_sync.push.status, 'done', JSON.stringify(handed.json));
  // B's earlier refusal left a state that lags the ledger; the pull and the release catch it up.
  const started = await b.hitld(['run', 'start', '--session', 's-B', '--host', 'example-host-2']);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  assert.equal(started.json.store_sync.pull.status, 'done');
});

test('lease is the lock: --replace and --force are the owner’s way past it', async () => {
  const f = fixture();
  const a = session(f, 'a', { identity: DEVICE_A.identity });
  const b = session(f, 'b', { identity: DEVICE_B.identity });
  await a.hitld(['run', 'start', '--session', 's-A', '--host', 'example-host-1']);
  await a.hitld(['run', 'checkpoint', '--session', 's-A', '--host', 'example-host-1']);
  const args = ['--session', 's-B', '--host', 'example-host-2'];
  const forced = await b.hitld(['run', 'resume', ...args, '--force']);
  assert.equal(forced.code, EXIT.ok, JSON.stringify(forced.json));
  assert.equal(forced.json.took_over.reason, 'owner');
  const c = session(f, 'c', { identity: DEVICE_B.identity });
  const replaced = await c.hitld([
    'run',
    'start',
    '--session',
    's-C',
    '--host',
    'cloud-3',
    '--replace',
  ]);
  assert.equal(replaced.code, EXIT.ok, JSON.stringify(replaced.json));
});

/**
 * Everything in a session's data directory, the store's git repository included: each file's path
 * and bytes, and the store's HEAD. A fetch or a merge adds objects or refs; a record changes a file.
 * @param {ReturnType<typeof session>} s
 */
function snapshot(s) {
  /** @type {Record<string, string>} */
  const files = {};
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files[relative(s.data, p)] = readFileSync(p).toString('base64');
    }
  };
  if (existsSync(s.data)) walk(s.data);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: s.store.root, encoding: 'utf8' });
  const ledger = ledgerKeys(s.store)
    .map((k) => s.store.read(k))
    .join('');
  return { head: head.stdout.trim(), ledger, files };
}

test('a release refused at run start or resume pulls nothing and records nothing (HITLD-110)', async () => {
  const f = fixture();
  const one = session(f, 'one', { identity: DEVICE_A.identity });
  const two = session(f, 'two', { identity: DEVICE_B.identity });
  const started = await one.hitld(['run', 'start', '--session', 's-1', '--host', 'example-host-1']);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  const first = await one.hitld([
    'run',
    'checkpoint',
    '--session',
    's-1',
    '--host',
    'example-host-1',
  ]);
  assert.equal(first.json.store_sync.push.result, 'pushed', JSON.stringify(first.json));
  // The second device has a store of its own, from the remote.
  const pulled = await two.hitld(['store', 'pull']);
  assert.equal(pulled.code, EXIT.ok, JSON.stringify(pulled.json));
  // The first session records more and pushes it: the remote is ahead of the second device.
  ask(one, 'E-9', 9);
  const second = await one.hitld([
    'run',
    'checkpoint',
    '--session',
    's-1',
    '--host',
    'example-host-1',
  ]);
  assert.equal(second.json.store_sync.push.result, 'pushed', JSON.stringify(second.json));
  const ahead = await remoteHead(f);

  const commands = [
    ['run', 'start', '--replace', '--session', 's-2', '--host', 'example-host-2'],
    ['run', 'resume', '--live', 'none', '--force', '--session', 's-2', '--host', 'example-host-2'],
  ];
  /** @param {string} error */
  const refusedAll = async (error) => {
    const before = snapshot(two);
    assert.ok(before.head && before.ledger, 'the second device has a store');
    for (const argv of commands) {
      const r = await two.hitld(argv);
      assert.deepEqual([r.code, r.json.error], [EXIT.failed, error], JSON.stringify(r.json));
      assert.equal('store_sync' in r.json, false, `${argv[1]}: no pull was tried`);
      assert.deepEqual(snapshot(two), before, `${argv[1]}: nothing fetched, merged or recorded`);
    }
    assert.equal(
      readLedger(two.store).events.some((e) => e.id === 'E-9'),
      false,
    );
    assert.equal(await remoteHead(f), ahead, 'the remote is as it was');
  };

  // The project pins a release this session does not run.
  const settings = join(f.project, '.claude', 'settings.json');
  mkdirSync(join(f.project, '.claude'), { recursive: true });
  const pinned = `v${bumpVersion(VERSION, 'major')}`;
  writeFileSync(
    settings,
    JSON.stringify({
      extraKnownMarketplaces: {
        'human-in-the-lead': { source: { source: 'github', repo: 'owner/plugin', ref: pinned } },
      },
    }),
  );
  await refusedAll('version-not-pinned');

  // No pin again, but the local store holds a ledger line a newer release wrote.
  rmSync(settings);
  const newer = /** @type {number} */ (schemas().currentVersion('ledger-entry')) + 1;
  const line = { schema_version: newer, id: 'E-99', event: 'logged', text: 'newer', at: at(30) };
  two.store.append(LEDGER_KEY, `${JSON.stringify(line)}\n`);
  await refusedAll('newer-schema');
});

test('enrollment: with nothing new, the next push makes the store readable by the new device', async () => {
  const f = fixture({ onlyA: true });
  const A = { name: 'device-a', id: DEVICE_A };
  const B = { name: 'device-b', id: DEVICE_B };
  const a = session(f, 'a', { identity: DEVICE_A.identity });
  await a.hitld(['run', 'start', '--session', 's-A', '--host', 'example-host-1']);
  const handed = await a.hitld(['handover', '--session', 's-A', '--host', 'example-host-1']);
  assert.equal(handed.json.store_sync.push.result, 'pushed', JSON.stringify(handed.json));
  const first = await a.hitld(['store', 'status']);
  assert.equal(first.json.push_due, false, JSON.stringify(first.json));
  assert.equal(first.json.push_reason, null);

  // The owner has not approved B: what the remote holds is not sealed to it.
  const early = session(f, 'early', { identity: DEVICE_B.identity });
  assert.equal((await early.hitld(['store', 'pull'])).json.error, 'age-no-match');

  // The owner's answer on A approves B. The head on the remote was sealed to A alone.
  approve(a.store, [B.name, B.id]);
  const due = await a.hitld(['store', 'status']);
  assert.equal(due.json.push_due, true);
  assert.equal(due.json.push_reason, 'local-changes');
  const pushed = await a.hitld(['store', 'push']);
  assert.equal(pushed.json.result, 'pushed', JSON.stringify(pushed.json));
  assert.equal(pushed.json.recipients, 2);
  assert.deepEqual(pushed.json.rotation.rotated, [], 'an enrollment prunes nothing');
  const after = await a.hitld(['store', 'status']);
  assert.equal(after.json.push_due, false);
  assert.equal((await a.hitld(['store', 'push'])).json.result, 'up-to-date');

  // B pulls it, and with nothing new has nothing to push.
  const b = session(f, 'b', { identity: DEVICE_B.identity });
  const pulled = await b.hitld(['store', 'pull']);
  assert.equal(pulled.code, EXIT.ok, JSON.stringify(pulled.json));
  assert.equal(pulled.json.ok, true);
  assert.equal((await b.hitld(['store', 'push'])).json.result, 'up-to-date');

  // A fresh cloud session on B's key starts its run: no store-pull-refused.
  rmSync(b.data, { recursive: true, force: true });
  const fresh = session(f, 'fresh', { identity: DEVICE_B.identity });
  const started = await fresh.hitld([
    'run',
    'start',
    '--session',
    's-B',
    '--host',
    'example-host-2',
  ]);
  assert.equal(started.code, EXIT.ok, JSON.stringify(started.json));
  assert.equal(started.json.store_sync.pull.status, 'done');
});

test('enrollment: a checkpoint with nothing new pushes once the device list has changed', async () => {
  const f = fixture({ onlyA: true });
  const A = { name: 'device-a', id: DEVICE_A };
  const B = { name: 'device-b', id: DEVICE_B };
  const a = session(f, 'a', { identity: DEVICE_A.identity });
  await a.hitld(['run', 'start', '--session', 's-A', '--host', 'example-host-1']);
  const first = await a.hitld([
    'run',
    'checkpoint',
    '--session',
    's-A',
    '--host',
    'example-host-1',
  ]);
  assert.equal(first.json.store_sync.push.result, 'pushed');
  const same = await a.hitld(['run', 'checkpoint', '--session', 's-A', '--host', 'example-host-1']);
  assert.equal(same.json.store_sync.push.result, 'up-to-date', JSON.stringify(same.json));
  approve(a.store, [B.name, B.id]);
  const cp = await a.hitld(['run', 'checkpoint', '--session', 's-A', '--host', 'example-host-1']);
  assert.equal(cp.json.store_sync.push.result, 'pushed', JSON.stringify(cp.json));
  const b = session(f, 'b', { identity: DEVICE_B.identity });
  assert.equal((await b.hitld(['store', 'pull'])).json.ok, true);
  // A removal takes the same route, and locks the removed device out again.
  removeApproved(a.store, B.name, B.id);
  const gone = await a.hitld(['run', 'checkpoint', '--session', 's-A', '--host', 'example-host-1']);
  assert.equal(gone.json.store_sync.push.result, 'pushed');
  assert.equal((await b.hitld(['store', 'pull'])).json.error, 'age-no-match');
});
