// Store sync in the run commands and the hooks (HITLD-106, design 0003 section 8): run start and
// resume pull, checkpoints, hand-over and merges push, and the SessionStart and SessionEnd hooks
// do the same for a session that dies between them. Two sessions are two private stores on two
// devices, with a bare repository standing in for the store's host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, EXIT } from '../lib/cli/main.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { generateIdentity } from '../lib/store/age.mjs';
import { createGitRemote } from '../lib/store/remote-git.mjs';
import { DEVICES_PATH, serializeDevices } from '../lib/store/devices.mjs';
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

const DEVICE_A = generateIdentity();
const DEVICE_B = generateIdentity();
const STRANGER = generateIdentity();
const HOOK = fileURLToPath(new URL('../harness/claude-code/hooks/store-sync.mjs', import.meta.url));
const at = (/** @type {number} */ n) => `2026-11-14T10:${String(n).padStart(2, '0')}:00.000Z`;

/**
 * A project checkout whose main enrols devices A and B, with an origin; and a bare repository
 * standing in for the store's host. `remote` false leaves policy.json without an address.
 * @param {{ remote?: boolean }} [o]
 */
function fixture(o = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-auto-sync-'));
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
      ...(o.remote === false ? {} : { store: { remote: { url } } }),
    }),
    [DEVICES_PATH]: serializeDevices({
      schema_version: 1,
      devices: [
        { name: 'device-a', recipient: DEVICE_A.recipient, added: '2026-11-15' },
        { name: 'device-b', recipient: DEVICE_B.recipient, added: '2026-11-15' },
      ],
    }),
  });
  commitAll(project, 'enrol a and b');
  const origin = join(dir, 'origin.git');
  fixtureGit(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  fixtureGit(project, 'remote', 'add', 'origin', origin);
  fixtureGit(project, 'push', '-q', 'origin', 'main');
  return { dir, project, bare, url };
}

/**
 * One session: its own private store (a data directory of its own) and the commands run as it.
 * @param {ReturnType<typeof fixture>} f @param {string} name
 * @param {{ identity?: string, env?: NodeJS.ProcessEnv }} [o]
 */
function session(f, name, o = {}) {
  const data = join(f.dir, 'data', name);
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    PATH: process.env.PATH,
    HOME: join(f.dir, 'home', name),
    XDG_DATA_HOME: data,
    XDG_CONFIG_HOME: join(f.dir, 'config', name),
    ...(o.identity ? { HITLD_STORE_IDENTITY: o.identity } : {}),
    ...o.env,
  };
  const store = openStore(privateStorePath('fixture', { env }));
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
  const started = await one.hitld(['run', 'start', '--session', 's-1', '--host', 'cloud-1']);
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
  const cp = await one.hitld(['run', 'checkpoint', '--session', 's-1', '--host', 'cloud-1']);
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
    'cloud-2',
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
  await one.hitld(['run', 'start', '--session', 's-1', '--host', 'cloud-1']);
  ask(one, 'E-1', 1);
  const handed = await one.hitld(['handover', '--session', 's-1', '--host', 'cloud-1']);
  assert.equal(handed.json.ok, true, JSON.stringify(handed.json));
  assert.equal(handed.json.store_sync.push.status, 'done');
  assert.ok(handed.json.released);

  const two = session(f, 'two', { identity: DEVICE_B.identity });
  const resumed = await two.hitld(['run', 'resume', '--session', 's-2', '--host', 'cloud-2']);
  assert.equal(resumed.code, EXIT.ok, JSON.stringify(resumed.json));
  assert.equal(resumed.json.took_over.reason, 'handover');
  // The hand-over note travelled with the store.
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

test('a remote set only for this machine is synced too', async () => {
  const f = fixture({ remote: false });
  const s = session(f, 's', { identity: DEVICE_A.identity });
  const set = await s.hitld(['store', 'remote', 'set', f.url]);
  assert.equal(set.code, EXIT.ok, JSON.stringify(set.json));
  await s.hitld(['run', 'start', '--session', 's-1', '--host', 'h']);
  const cp = await s.hitld(['run', 'checkpoint', '--session', 's-1', '--host', 'h']);
  assert.equal(cp.json.store_sync.push.result, 'pushed');
  assert.equal(cp.json.store_sync.push.remote.source, 'machine');
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
