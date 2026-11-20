// The owner's settings travel in the project's private store (HITLD-148, decided in HITLD-162 and
// HITLD-163): a fresh cloud container reads them there and asks nothing the owner already answered;
// without a store the setup runs as before; a copy that could not be brought up to date is not
// used, and the session runs on conservative defaults and says why.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { fakeWorkstation, writeSetupDone } from '../lib/eval/orchestrator-fixtures.mjs';
import { settingsLocation, writeSettingsFile } from '../lib/settings/files.mjs';
import { MACHINE_KEY, PERSON_KEY, readStoreSettings } from '../lib/settings/store-copy.mjs';
import { readLastPull, recordPull } from '../lib/store/last-pull.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, makeConsumer } from './orchestrator-fixture.mjs';

const PROJECT = 'orch-fixture';
/** A cloud session in an enrolled environment: the store's address comes from the environment. */
const CLOUD = { CLAUDE_CODE_REMOTE: '1', HITLD_STORE_REMOTE: '/nowhere/the-store.git' };

const OWNER = {
  // Version 2 added the attention budget; the copy is stamped with the lowest its content needs.
  schema_version: 2,
  max_executors: 3,
  quota: { reserve: 0.4 },
  attention: { quiet_hours: [{ from: '22:00', to: '07:00' }] },
};

/** @param {ReturnType<typeof makeConsumer>} c */
const storeOf = (c) => privateStorePath(PROJECT, { env: c.env });

/** @param {ReturnType<typeof makeConsumer>} c @param {Record<string, any>} data */
const putPerson = (c, data) =>
  openStore(storeOf(c)).write(PERSON_KEY, JSON.stringify(data, null, 2) + '\n');

/** @param {ReturnType<typeof makeConsumer>} c */
const removeHomeSettings = (c) => {
  for (const kind of /** @type {const} */ (['person', 'machine'])) {
    rmSync(settingsLocation(kind, { env: c.env }).path, { force: true });
  }
};

/** @param {any} r @param {string} key @returns {any} */
const value = (r, key) => r.values.find((/** @type {any} */ e) => e.key === key);

/**
 * The owner's first session: setup answered once, written through config write.
 * @param {ReturnType<typeof makeConsumer>} c
 */
async function ownerAnswered(c) {
  const w = await c.hitld(['config', 'write', 'person', '--data', JSON.stringify(OWNER)]);
  assert.equal(w.result.ok, true, JSON.stringify(w.result));
  assert.deepEqual(w.result.store, {
    key: PERSON_KEY,
    written: true,
    next: 'hitld store push carries it to the store remote, so a new session reads it',
  });
  return w;
}

test('config write person puts the settings that travel in the project store, and nothing that names another project', async () => {
  const c = makeConsumer({ setup: false });
  const data = {
    ...OWNER,
    projects: {
      [PROJECT]: { store_remote: '/somewhere/this-store.git', share: 2 },
      other: { store_remote: '/somewhere/other-store.git', share: 1 },
    },
  };
  const w = await c.hitld(['config', 'write', 'person', '--data', JSON.stringify(data)]);
  assert.equal(w.result.ok, true, JSON.stringify(w.result));
  const copy = JSON.parse(String(openStore(storeOf(c)).read(PERSON_KEY)));
  assert.deepEqual(copy, OWNER);
  assert.doesNotMatch(JSON.stringify(copy), /other|store_remote|share/);
});

test('a store copy that holds keys naming other projects is refused, not read', () => {
  const c = makeConsumer({ setup: false });
  putPerson(c, { ...OWNER, projects: { other: { share: 1 } } });
  const s = readStoreSettings(storeOf(c), { projectId: PROJECT, env: c.env });
  assert.equal(s.state, 'unreadable');
  assert.match(s.reason ?? '', /holds projects, which never travel/);
  assert.equal(s.person, null);
});

test('a fresh cloud container with the store reads the owner settings and asks only for the machine', async () => {
  const c = makeConsumer({ setup: false });
  await ownerAnswered(c);
  // A new container: no person or machine file in its home, the store pulled at session start.
  removeHomeSettings(c);
  recordPull(storeOf(c), { status: 'done' });
  const env = { ...CLOUD };
  const r = (await c.hitld(['config', 'explain', '--json'], { env })).result;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.setup.missing, ['machine']);
  assert.deepEqual(r.setup.from_store, ['person']);
  assert.equal(r.setup.conservative, null);
  assert.equal(r.files.person.present, false);
  assert.equal(r.files.person.source, 'store');
  assert.equal(r.files.person.store.state, 'read');
  assert.equal(value(r, 'quota.reserve').value, 0.4);
  assert.equal(value(r, 'quota.reserve').layer, 'person');
  assert.deepEqual(r.attention.quiet_hours, OWNER.attention.quiet_hours);
  const text = (await c.hitld(['config', 'explain'], { env })).result.text;
  assert.match(text, /from the project's store: person/);
  // The machine is recorded from the probe at session start, asking nothing; then setup is done.
  writeSettingsFile(
    'machine',
    { schema_version: 1, max_executors: 4 },
    { env: c.env, cwd: tmpdir() },
  );
  const after = (await c.hitld(['config', 'explain', '--json'], { env })).result;
  assert.equal(after.setup.done, true);
  assert.equal(after.cap, 3, 'the owner cap from the store applies');
});

test('a session without the store runs the setup as before', async () => {
  const c = makeConsumer({ setup: false });
  const r = (await c.hitld(['config', 'explain', '--json'], { env: { CLAUDE_CODE_REMOTE: '1' } }))
    .result;
  assert.deepEqual(r.setup.missing, ['person', 'machine']);
  assert.deepEqual(r.setup.from_store, []);
  assert.equal(r.setup.conservative, null);
  assert.equal(r.files.person.store, null);
  // Enrolled, and the store reached but empty (the first session ever): the setup asks too.
  recordPull(storeOf(c), { status: 'done' });
  const empty = (await c.hitld(['config', 'explain', '--json'], { env: CLOUD })).result;
  assert.deepEqual(empty.setup.missing, ['person', 'machine']);
  assert.equal(empty.setup.conservative, null);
});

test('the store cannot be reached at session start: conservative defaults, it says why, and asks nothing the store answers', async () => {
  const c = makeConsumer({ setup: false });
  await ownerAnswered(c);
  removeHomeSettings(c);
  recordPull(storeOf(c), {
    status: 'unreachable',
    code: 'remote-unreachable',
    message: 'could not resolve host',
  });
  writeSettingsFile(
    'machine',
    { schema_version: 1, max_executors: 4 },
    { env: c.env, cwd: tmpdir() },
  );
  const r = (await c.hitld(['config', 'explain', '--json'], { env: CLOUD })).result;
  assert.equal(r.setup.done, true, 'nothing is asked that the store would answer');
  assert.deepEqual(r.setup.missing, []);
  assert.match(r.setup.conservative, /not read from the project's store/);
  assert.match(r.setup.conservative, /could not reach the remote: remote-unreachable/);
  assert.match(r.setup.conservative, /one executor, the default reserve, no declared limits/);
  assert.equal(value(r, 'quota.reserve').layer, 'default', 'the stale copy is not used');
  // The run goes on at one executor, and the plan says why.
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  await c.hitld(['run', 'start', '--no-sync'], { env: CLOUD });
  const plan = (await c.hitld(['dispatch', 'plan'], { env: CLOUD })).result;
  assert.equal(plan.cap, 1);
  assert.ok(plan.held.every((/** @type {{ reason: string }} */ h) => h.reason !== 'setup'));
  assert.ok(plan.start.length <= 1);
});

test('an enrolled session that has not pulled yet does not read the copy, and says to pull', () => {
  const c = makeConsumer({ setup: false });
  putPerson(c, OWNER);
  const s = readStoreSettings(storeOf(c), { projectId: PROJECT, env: { ...c.env, ...CLOUD } });
  assert.equal(s.state, 'unreadable');
  assert.match(s.reason ?? '', /not been pulled in this session yet/);
});

test('a stale copy: a person file left in the container gives way to the store, or to the defaults when the store cannot be read', async () => {
  const c = makeConsumer({ setup: false });
  await ownerAnswered(c);
  // An older person file in the container's home, with a looser cap and a smaller reserve.
  writeSettingsFile(
    'person',
    { schema_version: 1, max_executors: 8, quota: { reserve: 0.1 } },
    { env: c.env, cwd: tmpdir() },
  );
  writeSettingsFile(
    'machine',
    { schema_version: 1, max_executors: 8 },
    { env: c.env, cwd: tmpdir() },
  );
  recordPull(storeOf(c), { status: 'done' });
  const fresh = (await c.hitld(['config', 'explain', '--json'], { env: CLOUD })).result;
  assert.equal(fresh.cap, 3, "the store's cap applies, not the container's");
  assert.equal(value(fresh, 'quota.reserve').value, 0.4);
  assert.equal(fresh.files.person.source, 'store-and-file');
  assert.deepEqual(fresh.files.person.store.replaced, ['max_executors', 'quota']);
  assert.ok(
    fresh.warnings.some((/** @type {{ message: string }} */ w) =>
      /differ from the project's store, whose values apply/.test(w.message),
    ),
  );
  // The pull at the next session start fails: neither the store's copy nor the container's is used.
  recordPull(storeOf(c), { status: 'failed', code: 'age-no-match', message: 'no key opens it' });
  const stale = (await c.hitld(['config', 'explain', '--json'], { env: CLOUD })).result;
  assert.equal(stale.files.person.store.local_file_ignored, true);
  assert.match(stale.setup.conservative, /the last pull .* failed: age-no-match/);
  assert.equal(value(stale, 'quota.reserve').layer, 'default');
  // On the owner's own machine (not a cloud session), their own file stands, with a warning.
  const machine = (
    await c.hitld(['config', 'explain', '--json'], {
      env: { HITLD_STORE_REMOTE: CLOUD.HITLD_STORE_REMOTE },
    })
  ).result;
  assert.equal(machine.files.person.source, 'file');
  assert.equal(machine.setup.conservative, null);
  assert.equal(value(machine, 'quota.reserve').value, 0.1);
  assert.ok(
    machine.warnings.some((/** @type {{ message: string }} */ w) =>
      /the project's store was not read/.test(w.message),
    ),
  );
});

test('config write person --merge in a fresh container starts from the store, not from nothing', async () => {
  const c = makeConsumer({ setup: false });
  await ownerAnswered(c);
  removeHomeSettings(c);
  recordPull(storeOf(c), { status: 'done' });
  const w = await c.hitld(
    ['config', 'write', 'person', '--merge', '--data', '{"quota":{"reserve":0.3}}'],
    { env: CLOUD },
  );
  assert.equal(w.result.ok, true, JSON.stringify(w.result));
  const copy = JSON.parse(String(openStore(storeOf(c)).read(PERSON_KEY)));
  assert.equal(copy.max_executors, 3);
  assert.equal(copy.quota.reserve, 0.3);
  assert.deepEqual(copy.attention, OWNER.attention);
});

test('an executor cannot change the settings in the store', async () => {
  const c = makeConsumer({ setup: false });
  await ownerAnswered(c);
  const before = openStore(storeOf(c)).read(PERSON_KEY);
  for (const env of [{ HITLD_DISPATCH: 'D-1' }, { HITLD_ROLE: 'executor' }]) {
    for (const kind of ['person', 'machine']) {
      const r = await c.hitld(['config', 'write', kind, '--data', '{"schema_version":1}'], { env });
      assert.equal(r.result.error, 'not-permitted');
    }
  }
  assert.equal(openStore(storeOf(c)).read(PERSON_KEY), before);
  assert.equal(openStore(storeOf(c)).read(MACHINE_KEY), null);
});

test("the owner's answers about a kind of machine are kept in the store and used at the next session start", async () => {
  const c = makeConsumer({ setup: false });
  const cloudProbe = { ...fakeWorkstation(), env: { CLAUDE_CODE_REMOTE: '1', PATH: '/usr/bin' } };
  /** @param {string[]} argv @param {NodeJS.ProcessEnv} [extra] */
  const run = async (argv, extra = {}) => {
    let out = '';
    await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: c.root,
      env: { ...c.env, ...extra },
      machine: cloudProbe,
    });
    return JSON.parse(out);
  };
  const first = await run(['machine', 'detect']);
  assert.equal(first.kind, 'cloud-vm');
  const answered = { ...first.proposed, max_executors: 2, disk_floor_mb: 2048 };
  const w = await c.hitld(['config', 'write', 'machine', '--data', JSON.stringify(answered)]);
  assert.equal(w.result.store.key, MACHINE_KEY);
  const kept = JSON.parse(String(openStore(storeOf(c)).read(MACHINE_KEY)));
  assert.equal(kept['cloud-vm'].max_executors, 2);
  assert.equal(kept['cloud-vm'].disk_floor_mb, 2048);
  assert.equal(kept['cloud-vm'].cores, undefined, 'the probe gives the rest');
  // A new container: no machine file; the store pulled at session start.
  removeHomeSettings(c);
  recordPull(storeOf(c), { status: 'done' });
  const next = await run(['machine', 'detect', '--write'], CLOUD);
  assert.equal(next.written, true, JSON.stringify(next));
  assert.equal(next.kind_source, 'store');
  assert.ok(next.from_store.includes('max_executors'));
  const file = JSON.parse(readFileSync(settingsLocation('machine', { env: c.env }).path, 'utf8'));
  assert.equal(file.max_executors, 2);
  assert.equal(file.disk_floor_mb, 2048);
  // Without a pull that reached the remote, the probe alone proposes the profile.
  removeHomeSettings(c);
  recordPull(storeOf(c), { status: 'unreachable', code: 'remote-unreachable', message: 'x' });
  const unreached = await run(['machine', 'detect'], CLOUD);
  assert.equal(unreached.kind_source, 'detected');
  assert.equal(unreached.proposed.disk_floor_mb, undefined);
});

test('a pull records what it did, and a damaged record reads as never pulled', async () => {
  const c = makeConsumer({ setup: false });
  const root = storeOf(c);
  assert.equal(readLastPull(root), null);
  const { pullStore } = await import('../lib/store/push-pull.mjs');
  const failing = {
    head: async () => {
      throw Object.assign(new Error('could not resolve host'), { code: 'remote-unreachable' });
    },
  };
  await assert.rejects(
    pullStore(
      /** @type {any} */ ({ root, projectId: PROJECT, remote: failing, url: '/x', devices: {} }),
    ),
  );
  assert.equal(readLastPull(root)?.status, 'unreachable');
  assert.equal(readLastPull(root)?.code, 'remote-unreachable');
  const empty = { head: async () => null };
  await pullStore(
    /** @type {any} */ ({ root, projectId: PROJECT, remote: empty, url: '/x', devices: {} }),
  );
  assert.equal(readLastPull(root)?.status, 'done');
  const path = join(root, '.git', 'hitld-pull.json');
  assert.ok(existsSync(path));
  openStore(root); // the record is inside .git, never a store key
  assert.equal(openStore(root).list().includes('.git/hitld-pull.json'), false);
  writeFileSync(path, '{ not json');
  assert.equal(readLastPull(root), null);
  rmSync(path);
  writeSetupDone(c.env);
});
