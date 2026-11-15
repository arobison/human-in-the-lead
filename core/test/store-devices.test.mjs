// Store devices (design 0003, sections 5, 6 and 9): a request's check, the owner's answers that
// make the approved set, the device port a push asks, rotation after a removal (milestone c3),
// the commands and the device decisions they ask, and the commit guard that keeps a device list
// out of the project's repository.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, EXIT } from '../lib/cli/main.mjs';
import { generateIdentity, recipientOf } from '../lib/store/age.mjs';
import { open, seal } from '../lib/store/sealed.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { createGitRemote } from '../lib/store/remote-git.mjs';
import { commitAll, fixtureGit, putFiles } from '../lib/eval/orchestrator-fixtures.mjs';
import { memoryRemote } from './helpers/memory-remote.mjs';
import { approve, removeApproved } from './helpers/devices.mjs';
import { keychain } from '../lib/env/keychain.mjs';
import { writeSettingsFile } from '../lib/settings/files.mjs';
import {
  APPROVALS_KEY,
  DevicesError,
  ROTATIONS_KEY,
  applyDeviceAnswer,
  approvedDevices,
  checkDevices,
  deviceQuestion,
  fingerprint,
  nameFromHost,
  openDeviceAsks,
  pendingRequests,
  pendingRotations,
  readApprovals,
  readRotations,
  recordApproval,
  recordRotation,
  requestText,
  serializeDevices,
} from '../lib/store/devices.mjs';
import { assertEnrolled, completeRotation, resolveDevices } from '../lib/store/devices-port.mjs';

const LAPTOP = generateIdentity();
const CLOUD = generateIdentity();
const GPU = generateIdentity();
const STRANGER = generateIdentity();
const DAY = '2026-11-15';

/** @param {string} name @param {{ recipient: string }} key */
const device = (name, key) => ({ name, recipient: key.recipient, added: DAY });
/** @param {...{ name: string, recipient: string, added: string }} devices */
const devicesText = (...devices) => serializeDevices({ schema_version: 1, devices });

/** A store of its own. */
const freshStore = () => openStore(mkdtempSync(join(tmpdir(), 'hitld-devices-store-')));

/** A keychain stand-in. @param {string | null} value */
const fakeKeychain = (value) => ({ read: () => value });

/** @param {import('../lib/store/store.mjs').PrivateStore} store @param {NodeJS.ProcessEnv} env */
const resolve = (store, env) => resolveDevices({ store, env, keychain: fakeKeychain(null) });

// --- a request --------------------------------------------------------------------------------

test('a request is a device list of one: public keys, names and dates only; keys checked', () => {
  const ok = checkDevices(
    devicesText(device('example-laptop', LAPTOP), device('example-cloud', CLOUD)),
  );
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.file?.devices.length, 2);
  assert.deepEqual(checkDevices(requestText(device('example-laptop', LAPTOP))).file?.devices, [
    device('example-laptop', LAPTOP),
  ]);

  const twice = checkDevices(
    devicesText(device('example-laptop', LAPTOP), device('example-laptop', CLOUD)),
  );
  assert.match(twice.problems.join(), /the name "example-laptop" appears twice/);
  const sameKey = checkDevices(
    devicesText(device('example-laptop', LAPTOP), device('other', LAPTOP)),
  );
  assert.match(sameKey.problems.join(), /enrolled twice/);

  // A private key, or anything else, is not a key the file may hold.
  const secret = checkDevices(
    JSON.stringify({
      schema_version: 1,
      devices: [{ name: 'example-laptop', recipient: LAPTOP.identity, added: DAY }],
    }),
  );
  assert.match(secret.problems.join(), /recipient/);
  assert.doesNotMatch(secret.problems.join(), /AGE-SECRET-KEY/);
  const extra = checkDevices(
    JSON.stringify({
      schema_version: 1,
      devices: [{ ...device('example-laptop', LAPTOP), identity: 'x' }],
    }),
  );
  assert.match(extra.problems.join(), /identity: is not a known key/);

  // A key with a broken checksum passes the pattern and fails the check.
  const last = LAPTOP.recipient.at(-1) === 'q' ? 'p' : 'q';
  const broken = checkDevices(
    devicesText({
      name: 'example-laptop',
      recipient: LAPTOP.recipient.slice(0, -1) + last,
      added: DAY,
    }),
  );
  assert.match(broken.problems.join(), /not an age public key/);

  assert.match(
    checkDevices(JSON.stringify({ schema_version: 2, devices: [] })).problems.join(),
    /newer than this release knows/,
  );
  assert.match(checkDevices('{').problems.join(), /does not parse/);
  assert.equal(nameFromHost('Owners-MacBook-Pro.local'), 'owners-macbook-pro');
  assert.equal(nameFromHost('---'), null);
  assert.match(fingerprint(LAPTOP.recipient), /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
  assert.notEqual(fingerprint(LAPTOP.recipient), fingerprint(CLOUD.recipient));
});

// --- the owner's answers -------------------------------------------------------------------------

test("the approved set is the owner's answers: approved, then removed; a request alone is nothing", () => {
  const store = freshStore();
  assert.deepEqual(approvedDevices(readApprovals(store)), []);
  approve(store, ['example-laptop', LAPTOP], ['example-gpu', GPU]);
  assert.deepEqual(
    approvedDevices(readApprovals(store)).map((d) => d.name),
    ['example-gpu', 'example-laptop'],
  );
  removeApproved(store, 'example-gpu', GPU);
  const records = readApprovals(store);
  assert.deepEqual(
    approvedDevices(records).map((d) => d.name),
    ['example-laptop'],
  );
  // A request for a key the owner approved, refused or removed is not waiting; a new one is.
  const requests = [
    device('example-laptop', LAPTOP),
    device('example-gpu', GPU),
    device('example-cloud', CLOUD),
  ];
  assert.deepEqual(
    pendingRequests(requests, records).map((d) => d.name),
    ['example-cloud'],
  );
  // A line that does not parse, or names another event, is skipped; lines merged in either order
  // fold by their time.
  store.append(APPROVALS_KEY, 'not json\n{"event":"granted","decision":"x"}\n');
  recordApproval(store, {
    event: 'approved',
    decision: 'W-1',
    action: 'enroll',
    name: 'old',
    recipient: CLOUD.recipient,
    at: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(readApprovals(store)[0].name, 'old');
  assert.deepEqual(
    approvedDevices(readApprovals(store)).map((d) => d.name),
    ['example-laptop', 'old'],
  );
});

test('an answer to a device decision applies it: A approves or removes, anything else refuses; other decisions are left alone', () => {
  const store = freshStore();
  /** @param {string} decision @param {'enroll' | 'remove'} action @param {string} name @param {{ recipient: string }} key */
  const ask = (decision, action, name, key) =>
    recordApproval(store, {
      event: 'asked',
      decision,
      action,
      name,
      recipient: key.recipient,
      added: DAY,
      at: `2026-11-15T10:0${decision.slice(-1)}:00.000Z`,
    });
  ask('W-1', 'enroll', 'example-laptop', LAPTOP);
  ask('W-2', 'enroll', 'example-cloud', CLOUD);
  assert.deepEqual(
    openDeviceAsks(readApprovals(store)).map((r) => r.decision),
    ['W-1', 'W-2'],
  );
  assert.equal(
    applyDeviceAnswer(store, { decision: 'W-9', option: 'A', at: '2026-11-15T11:00:00Z' }),
    null,
  );
  assert.equal(
    applyDeviceAnswer(store, { decision: 'W-1', option: 'A', at: '2026-11-15T11:00:00Z' })?.event,
    'approved',
  );
  assert.equal(
    applyDeviceAnswer(store, { decision: 'W-2', option: 'B', at: '2026-11-15T11:01:00Z' })?.event,
    'refused',
  );
  // Answered once: a second answer changes nothing.
  assert.equal(
    applyDeviceAnswer(store, { decision: 'W-1', option: 'B', at: '2026-11-15T11:02:00Z' }),
    null,
  );
  ask('W-3', 'remove', 'example-laptop', LAPTOP);
  assert.equal(
    applyDeviceAnswer(store, { decision: 'W-3', option: 'A', at: '2026-11-15T11:03:00Z' })?.event,
    'removed',
  );
  const records = readApprovals(store);
  assert.deepEqual(approvedDevices(records), []);
  assert.deepEqual(openDeviceAsks(records), []);
  // The refused key stays out: it asks again only with a new key.
  assert.deepEqual(pendingRequests([device('example-cloud', CLOUD)], records), []);
});

test('approval lines written before HITLD-121 with the old spelling are read as enroll and never rewritten', () => {
  const store = freshStore();
  const line = (/** @type {Record<string, unknown>} */ r) => `${JSON.stringify(r)}\n`;
  const old = {
    decision: 'W-1',
    action: 'enrol', // spelling-ok: the spelling the log held before HITLD-121
    name: 'example-laptop',
    recipient: LAPTOP.recipient,
    added: DAY,
  };
  store.append(APPROVALS_KEY, line({ ...old, event: 'asked', at: '2026-11-15T10:00:00.000Z' }));
  const before = store.read(APPROVALS_KEY);

  const records = readApprovals(store);
  assert.deepEqual(
    records.map((r) => [r.event, r.action]),
    [['asked', 'enroll']],
  );
  assert.equal(openDeviceAsks(records).length, 1);
  // An answer bound to what the old question named still finds its device.
  const binds = {
    action: 'enrol', // spelling-ok
    name: 'example-laptop',
    fingerprint: fingerprint(LAPTOP.recipient),
  };
  const answered = applyDeviceAnswer(store, {
    decision: 'W-1',
    option: 'A',
    at: '2026-11-15T11:00:00Z',
    binds,
  });
  assert.deepEqual([answered?.event, answered?.action], ['approved', 'enroll']);
  assert.deepEqual(
    approvedDevices(readApprovals(store)).map((d) => d.name),
    ['example-laptop'],
  );
  // The old line is as it was written: the log is append-only.
  assert.ok(store.read(APPROVALS_KEY)?.startsWith(before ?? ''));
  assert.match(store.read(APPROVALS_KEY) ?? '', /"action":"enrol"/); // spelling-ok
});

test('the device question names a fingerprint, not the device, goes to the owner and carries no default', () => {
  const q = deviceQuestion('enroll', device('example-main-device', LAPTOP), 'W-1');
  const text = JSON.stringify(q);
  assert.doesNotMatch(text, /example-main-device/);
  assert.doesNotMatch(text, new RegExp(LAPTOP.recipient));
  assert.match(q.question, new RegExp(fingerprint(LAPTOP.recipient)));
  assert.deepEqual(
    q.triggers.map((t) => t.basis),
    ['rule-change', 'security'],
  );
  assert.equal('default_if_unanswered' in q, false);
  assert.equal(q.parent, 'W-1');
  assert.match(deviceQuestion('remove', device('example-gpu', GPU), undefined).title, /Remove/);
});

// --- the port ----------------------------------------------------------------------------------

test('the port: recipients from the approved set, the identity from the environment or the keychain', () => {
  const store = freshStore();
  approve(store, ['example-laptop', LAPTOP], ['example-cloud', CLOUD]);

  const cloud = resolve(store, { HITLD_STORE_IDENTITY: CLOUD.identity });
  assert.deepEqual(cloud.recipients.sort(), [CLOUD.recipient, LAPTOP.recipient].sort());
  assert.equal(cloud.identity, CLOUD.identity);
  assert.equal(cloud.enrolled, true);
  assert.equal(cloud.device, 'example-cloud');
  assert.equal(cloud.key_source, 'environment');
  assert.equal(assertEnrolled(cloud).device, 'example-cloud');

  const local = resolveDevices({ store, env: {}, keychain: fakeKeychain(LAPTOP.identity) });
  assert.equal(local.device, 'example-laptop');
  assert.equal(local.key_source, 'keychain');

  // Several keys in the variable: the approved one is this device's.
  const several = resolve(store, {
    HITLD_STORE_IDENTITY: `# another project\n${STRANGER.identity}\n${CLOUD.identity}\n`,
  });
  assert.equal(several.identity, CLOUD.identity);
  assert.equal(several.device, 'example-cloud');
});

test('a push from a device the owner has not approved is refused by name: device-not-enrolled', () => {
  const store = freshStore();
  approve(store, ['example-laptop', LAPTOP]);
  /** @param {ReturnType<typeof resolveDevices>} res */
  const refused = (res) =>
    assert.throws(
      () => assertEnrolled(res),
      (e) => e instanceof DevicesError && e.code === 'device-not-enrolled',
    );

  const stranger = resolve(store, { HITLD_STORE_IDENTITY: STRANGER.identity });
  assert.equal(stranger.enrolled, false);
  assert.equal(stranger.device, null);
  assert.match(String(stranger.problem), new RegExp(fingerprint(STRANGER.recipient)));
  refused(stranger);

  const none = resolve(store, {});
  assert.equal(none.identity, null);
  assert.match(String(none.problem), /no key/);
  refused(none);

  const bad = resolve(store, { HITLD_STORE_IDENTITY: 'AGE-SECRET-KEY-1NOTAKEY' });
  assert.equal(bad.identity, null);
  assert.doesNotMatch(String(bad.problem), /NOTAKEY/);
  refused(bad);

  // Asked, not answered: still refused.
  recordApproval(store, {
    event: 'asked',
    decision: 'W-5',
    action: 'enroll',
    name: 'x',
    recipient: STRANGER.recipient,
    at: '2026-11-15T10:00:00.000Z',
  });
  refused(resolve(store, { HITLD_STORE_IDENTITY: STRANGER.identity }));
});

// --- rotation: milestone c3 --------------------------------------------------------------------

test('c3: after the owner approves a removal, nothing pushed opens with the removed key, and older files are pruned', async () => {
  const store = freshStore();
  approve(store, ['example-laptop', LAPTOP], ['example-gpu', GPU]);
  const remote = memoryRemote().open();
  const manifest = {
    project: 'fixture',
    schema_versions: {},
    head: '0'.repeat(40),
    branch: 'main',
    created_at: '2026-11-15T10:00:00.000Z',
    hitld_version: 'test',
  };
  /** A push as store push makes it: refuse an unapproved device, encrypt to the approved set. */
  const push = async (/** @type {string} */ text) => {
    const res = assertEnrolled(resolve(store, { HITLD_STORE_IDENTITY: LAPTOP.identity }));
    const bytes = seal(manifest, Buffer.from(text), res.recipients);
    const version = await remote.push(bytes, { expected: await remote.head() });
    return {
      version,
      rotation: await completeRotation({ remote, store, resolution: res, version }),
    };
  };
  /** @param {{ identity: string }} who @param {string} version */
  const opens = async (who, version) => {
    try {
      open(await remote.fetch(version), { identities: [who.identity] });
      return true;
    } catch (e) {
      assert.equal(/** @type {{ code?: string }} */ (e).code, 'age-no-match');
      return false;
    }
  };

  const first = await push('before the removal');
  assert.deepEqual(first.rotation, { rotated: [], removed: [] });
  assert.equal(await opens(GPU, first.version), true);

  // The owner's answer removes example-gpu.
  removeApproved(store, 'example-gpu', GPU);
  const pending = resolve(store, {}).rotation.pending;
  assert.deepEqual(
    pending.map((p) => p.name),
    ['example-gpu'],
  );

  const second = await push('after the removal');
  assert.equal(await opens(GPU, second.version), false, 'not encrypted to the removed key');
  assert.equal(await opens(LAPTOP, second.version), true);
  assert.deepEqual(second.rotation, { rotated: ['example-gpu'], removed: [first.version] });
  // The remote holds nothing the removed key opens.
  assert.equal(await remote.head(), second.version);
  await assert.rejects(remote.fetch(first.version), /no v1/);
  assert.deepEqual(
    readRotations(store).map((x) => [x.event, x.name]),
    [['rotated', 'example-gpu']],
  );

  // Done once: the next push prunes nothing.
  assert.deepEqual(resolve(store, {}).rotation.pending, []);
  const third = await push('later');
  assert.deepEqual(third.rotation, { rotated: [], removed: [] });
  assert.equal(await opens(GPU, third.version), false);
});

test('a removal is pending until rotated after it; enrolled again and removed again, it is pending again', () => {
  const at = (/** @type {number} */ h) => `2026-11-15T${String(h).padStart(2, '0')}:00:00Z`;
  const removal = { name: 'example-gpu', recipient: GPU.recipient, at: at(10), commit: 'W-4' };
  assert.deepEqual(
    pendingRotations({ removals: [removal], records: [], current: [LAPTOP.recipient] }),
    [removal],
  );
  // Approved again: not pending, whatever the store says.
  assert.deepEqual(
    pendingRotations({ removals: [removal], records: [], current: [GPU.recipient] }),
    [],
  );
  const rotated = /** @type {const} */ ({
    event: 'rotated',
    name: 'example-gpu',
    recipient: GPU.recipient,
    at: at(11),
    version: 'v2',
  });
  assert.deepEqual(pendingRotations({ removals: [removal], records: [rotated], current: [] }), []);
  const again = { ...removal, at: at(12), commit: 'W-7' };
  assert.deepEqual(
    pendingRotations({ removals: [removal, again], records: [rotated], current: [] }),
    [again],
  );
  // A removal recorded before the owner's answers were kept in the store counts too.
  const recorded = /** @type {const} */ ({
    event: 'removed',
    name: 'example-gpu',
    recipient: GPU.recipient,
    at: at(9),
  });
  assert.equal(pendingRotations({ removals: [], records: [recorded], current: [] }).length, 1);
});

test('rotation records are append-only lines in the private store; a bad line is skipped', () => {
  const store = freshStore();
  recordRotation(store, {
    event: 'removed',
    name: 'example-gpu',
    recipient: GPU.recipient,
    at: DAY,
  });
  store.append(ROTATIONS_KEY, 'not json\n{"event":"other"}\n');
  assert.deepEqual(
    readRotations(store).map((x) => x.event),
    ['removed'],
  );
});

// --- the commands ------------------------------------------------------------------------------

/**
 * A stand-in keychain tool on PATH: `secret-tool` (Linux) and `security` (macOS), storing values
 * in files and logging every argument list, so a test can see a key never went on a command line.
 * @param {string} base
 */
function fakeKeychainTools(base) {
  const bin = join(base, 'bin');
  const vault = join(base, 'vault');
  mkdirSync(bin);
  mkdirSync(vault);
  const log = join(base, 'argv.log');
  writeFileSync(
    join(bin, 'secret-tool'),
    `#!/bin/sh
echo "$@" >> "${log}"
cmd=$1; shift
if [ "$cmd" = store ]; then shift; cat > "${vault}/$2__$4"; exit 0; fi
if [ "$cmd" = lookup ]; then [ -f "${vault}/$2__$4" ] || exit 1; cat "${vault}/$2__$4"; exit 0; fi
exit 2
`,
  );
  writeFileSync(
    join(bin, 'security'),
    `#!/bin/sh
echo "$@" >> "${log}"
if [ "$1" = find-generic-password ]; then [ -f "${vault}/$3__$5" ] || exit 44; cat "${vault}/$3__$5"; echo; exit 0; fi
if [ "$1" = -i ]; then
  read -r line
  s=$(echo "$line" | sed 's/.* -s \\([^ ]*\\) .*/\\1/'); a=$(echo "$line" | sed 's/.* -a \\([^ ]*\\) .*/\\1/')
  v=$(echo "$line" | sed 's/.* -w \\([^ ]*\\)$/\\1/')
  printf %s "$v" > "${vault}/\${s}__\${a}"; exit 0
fi
exit 2
`,
  );
  chmodSync(join(bin, 'secret-tool'), 0o755);
  chmodSync(join(bin, 'security'), 0o755);
  return { bin, vault, log, PATH: `${bin}:${process.env.PATH ?? ''}` };
}

for (const platform of /** @type {const} */ (['linux', 'darwin'])) {
  test(
    `the keychain on ${platform}: stores a value from standard input, never replaces one, reads it back`,
    { skip: process.platform === 'win32' && 'the stand-in tools are shell scripts' },
    () => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), 'hitld-keychain-')));
      const tools = fakeKeychainTools(base);
      const kc = keychain({ service: 'hitld-store-x', platform, env: { PATH: tools.PATH } });
      assert.equal(kc.read('device-identity'), null);
      assert.deepEqual(kc.write('device-identity', LAPTOP.identity, 'a label (x)'), { ok: true });
      assert.equal(kc.read('device-identity'), LAPTOP.identity);
      const again = kc.write('device-identity', GPU.identity, 'a label');
      assert.equal(again.ok, false);
      assert.equal(kc.read('device-identity'), LAPTOP.identity);
      assert.ok(!readFileSync(tools.log, 'utf8').includes(LAPTOP.identity), 'never on argv');
      assert.equal(kc.write('device-identity', 'two words', 'l').ok, false);
      assert.equal(keychain({ service: 's', platform: 'win32' }).tool, null);
    },
  );
}

/** Every file under a directory whose bytes hold a text. @param {string} dir @param {string} text */
const filesHolding = (dir, text) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name))
    .filter((p) => readFileSync(p).includes(Buffer.from(text)));

/** @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} env */
async function hitld(argv, cwd, env) {
  let out = '';
  const code = await main(argv, {
    out: (t) => (out += t),
    err: () => {},
    cwd,
    env,
    now: () => new Date('2026-11-15T12:00:00Z'),
  });
  return { code, json: JSON.parse(out) };
}

const keychainTests = process.platform === 'linux' || process.platform === 'darwin';

/**
 * A project on main with a policy.json and a tracker project to file device decisions under, a
 * bare repository standing in for the store repository, and the environment one device runs in:
 * its own data and config directories, and the store's address in HITLD_STORE_REMOTE.
 */
function project() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hitld-devices-')));
  const root = join(base, 'repo');
  mkdirSync(root);
  fixtureGit(root, 'init', '-q', '-b', 'main');
  fixtureGit(root, 'config', 'user.name', 'Fixture');
  fixtureGit(root, 'config', 'user.email', 'fixture@example.invalid');
  fixtureGit(root, 'config', 'commit.gpgsign', 'false');
  putFiles(root, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
    }),
    'work/projects/W-1-the-store.md':
      '---\nid: W-1\ntitle: "The store"\nkind: project\nstate: planned\ncreated: 2026-11-15\n---\n',
    'README.md': 'a project\n',
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAll(root, 'start');
  const host = join(base, 'host', 'store.git');
  mkdirSync(host, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', '--bare'], { cwd: host }).status, 0);
  const url = `file://${host}`;
  /** @param {string} name @param {NodeJS.ProcessEnv} [more] @returns {NodeJS.ProcessEnv} */
  const envOf = (name, more = {}) => ({
    PATH: process.env.PATH,
    HOME: join(base, 'home', name),
    XDG_DATA_HOME: join(base, 'data', name),
    XDG_CONFIG_HOME: join(base, 'config', name),
    HITLD_STORE_REMOTE: url,
    ...more,
  });
  /** @param {NodeJS.ProcessEnv} env */
  const storeOf = (env) => openStore(privateStorePath('fixture', { env }));
  return { base, root, host, url, envOf, storeOf };
}

/** The device names asking on a host's hitld-devices branch. @param {string} host */
function requestsOnHost(host) {
  const r = spawnSync('git', ['ls-tree', '--name-only', 'refs/heads/hitld-devices', 'proposals/'], {
    env: { PATH: process.env.PATH ?? '', GIT_DIR: host },
    encoding: 'utf8',
  });
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((p) => p.replace(/^proposals\/|\.json$/g, ''));
}

/** Put a request on the host's branch by hand, as anyone who can write it could. @param {string} host @param {{ name: string, recipient: string, added: string }} d */
function plantRequest(host, d) {
  const env = {
    PATH: process.env.PATH ?? '',
    GIT_DIR: host,
    GIT_AUTHOR_NAME: 'x',
    GIT_AUTHOR_EMAIL: 'x@example.invalid',
    GIT_COMMITTER_NAME: 'x',
    GIT_COMMITTER_EMAIL: 'x@example.invalid',
  };
  /** @param {string[]} args @param {string} [input] */
  const g = (args, input) => spawnSync('git', args, { env, input, encoding: 'utf8' }).stdout.trim();
  const tip = g(['rev-parse', '--verify', '--quiet', 'refs/heads/hitld-devices']);
  const blob = g(['hash-object', '-w', '--stdin'], requestText(d));
  const listed = tip ? g(['ls-tree', `${tip}:proposals`]) : '';
  const sub = g(['mktree'], `${listed ? `${listed}\n` : ''}100644 blob ${blob}\t${d.name}.json\n`);
  const tree = g(['mktree'], `040000 tree ${sub}\tproposals\n`);
  const commit = g(['commit-tree', tree, ...(tip ? ['-p', tip] : []), '-m', 'planted']);
  g(['update-ref', 'refs/heads/hitld-devices', commit]);
}

test(
  'device init on a local machine: the key goes to the keychain, the request to the branch; the first device asks for itself',
  { skip: !keychainTests && 'no keychain tool on this platform' },
  async () => {
    const p = project();
    const kc = fakeKeychainTools(p.base);
    const env = p.envOf('example-laptop', { PATH: kc.PATH });
    const out = await hitld(['store', 'device', 'init', '--name', 'example-laptop'], p.root, env);
    assert.equal(out.code, EXIT.ok, JSON.stringify(out.json));
    assert.equal(out.json.device, 'example-laptop');
    assert.equal(out.json.status, 'requested');
    assert.equal(out.json.key_created, true);
    assert.deepEqual(out.json.key, {
      where: 'keychain',
      service: 'hitld-store-fixture',
      account: 'device-identity',
    });
    assert.equal(out.json.identity, undefined, 'a local key is never printed');
    assert.equal(out.json.fingerprint, fingerprint(out.json.recipient));
    assert.deepEqual(out.json.request, {
      branch: 'hitld-devices',
      file: 'proposals/example-laptop.json',
      pushed: true,
    });
    assert.deepEqual(requestsOnHost(p.host), ['example-laptop']);
    // The first device of an empty store asks the owner itself.
    const decision = out.json.decision.decision;
    assert.match(decision, /^W-\d+$/);
    assert.match(out.json.decision.text, new RegExp(out.json.fingerprint));
    assert.doesNotMatch(out.json.decision.text, /example-laptop/);
    // The decision item, a file in the project's repository, names neither the device nor its key.
    const items = readdirSync(join(p.root, 'work', 'items'));
    const item = readFileSync(join(p.root, 'work', 'items', items[0]), 'utf8');
    assert.doesNotMatch(item, /example-laptop|age1/);

    const stored = readdirSync(kc.vault);
    assert.deepEqual(stored, ['hitld-store-fixture__device-identity']);
    const identity = readFileSync(join(kc.vault, stored[0]), 'utf8').trim();
    assert.equal(recipientOf(identity), out.json.recipient);
    assert.ok(!readFileSync(kc.log, 'utf8').includes(identity), 'the key never went on argv');
    assert.ok(!JSON.stringify(out.json).includes(identity));

    // Nothing is pushed until the owner answers, and no sweep answers for them.
    await hitld(['run', 'start', '--host', 'example-laptop'], p.root, env);
    assert.equal((await hitld(['store', 'push'], p.root, env)).json.error, 'device-not-enrolled');
    const swept = await hitld(['rights', 'sweep'], p.root, env);
    assert.deepEqual(swept.json.applied, [], JSON.stringify(swept.json));
    const status = await hitld(['store', 'status'], p.root, env);
    assert.deepEqual(
      status.json.devices.decisions.map((/** @type {any} */ d) => [d.decision, d.name]),
      [[decision, 'example-laptop']],
    );
    assert.equal(status.json.reminders, undefined, 'no branch to protect');
    assert.equal(await createGitRemote({ url: p.url, dir: join(p.base, 'peek') }).head(), null);

    // Again before the answer: the same request, the same decision.
    const again = await hitld(['store', 'device', 'init', '--name', 'example-laptop'], p.root, env);
    assert.equal(again.json.changed, false);
    assert.equal(again.json.decision.decision, decision);

    // The owner's own answer approves it; then the push goes.
    const answered = await hitld(['rights', 'answer', decision, '--answer', 'A'], p.root, env);
    assert.equal(answered.json.ok, true, JSON.stringify(answered.json));
    assert.equal(answered.json.device.event, 'approved');
    const pushed = await hitld(['store', 'push'], p.root, env);
    assert.equal(pushed.json.result, 'pushed', JSON.stringify(pushed.json));
    assert.equal(pushed.json.recipients, 1);
    const listed = await hitld(['store', 'device', 'list'], p.root, env);
    assert.deepEqual(
      listed.json.approved.map((/** @type {any} */ d) => [d.name, d.status]),
      [['example-laptop', 'approved']],
    );
    assert.deepEqual(listed.json.requests, []);
    assert.equal(listed.json.this_device.enrolled, true);
    const done = await hitld(['store', 'device', 'init', '--name', 'example-laptop'], p.root, env);
    assert.deepEqual([done.json.status, done.json.changed], ['approved', false]);
  },
);

test('device init: a name another key uses is refused before any key is made; no keychain is refused with a way on', async () => {
  const p = project();
  plantRequest(p.host, device('example-laptop', LAPTOP));
  const kc = fakeKeychainTools(p.base);
  const env = p.envOf('desk', { PATH: kc.PATH });
  const taken = await hitld(['store', 'device', 'init', '--name', 'example-laptop'], p.root, env);
  assert.equal(taken.json.error, 'device-name-taken');
  assert.deepEqual(readdirSync(kc.vault), [], 'no orphan key');

  const empty = join(p.base, 'empty-bin');
  mkdirSync(empty);
  const none = await hitld(
    ['store', 'device', 'init', '--name', 'desk'],
    p.root,
    p.envOf('desk', { PATH: empty }),
  );
  assert.equal(none.code, EXIT.failed);
  assert.equal(none.json.error, 'device-no-keychain');
  assert.match(none.json.message, /--cloud/);
  assert.match(none.json.message, /HITLD_STORE_IDENTITY/);

  const badName = await hitld(['store', 'device', 'init', '--name', 'My Laptop'], p.root, env);
  assert.equal(badName.json.error, 'device-name-invalid');
  const noAddress = await hitld(
    ['store', 'device', 'init', '--cloud', '--name', 'x'],
    p.root,
    p.envOf('desk', { HITLD_STORE_REMOTE: '' }),
  );
  assert.equal(noAddress.json.error, 'no-remote');
});

test('device init --cloud: the key is printed once for the environment variable, and written nowhere', async () => {
  const p = project();
  const kc = fakeKeychainTools(p.base);
  const env = p.envOf('owner', { PATH: kc.PATH });
  const unnamed = await hitld(['store', 'device', 'init', '--cloud'], p.root, env);
  assert.equal(unnamed.json.error, 'device-name-required');

  const out = await hitld(
    ['store', 'device', 'init', '--cloud', '--name', 'example-cloud'],
    p.root,
    env,
  );
  assert.equal(out.code, EXIT.ok, JSON.stringify(out.json));
  assert.deepEqual(out.json.key, { where: 'environment', variable: 'HITLD_STORE_IDENTITY' });
  assert.equal(recipientOf(out.json.identity), out.json.recipient);
  assert.match(out.json.message, /does not show it again/);
  assert.match(out.json.next, /^set HITLD_STORE_IDENTITY/);
  assert.deepEqual(readdirSync(kc.vault), [], 'nothing in the keychain');
  assert.deepEqual(filesHolding(p.base, out.json.identity), [], 'nothing on disk');

  // In the environment, with the variable set: ask for that key, print nothing secret.
  const q = project();
  const set = await hitld(
    ['store', 'device', 'init', '--cloud', '--name', 'example-cloud'],
    q.root,
    q.envOf('cloud', { HITLD_STORE_IDENTITY: CLOUD.identity }),
  );
  assert.equal(set.code, EXIT.ok, JSON.stringify(set.json));
  assert.equal(set.json.recipient, CLOUD.recipient);
  assert.equal(set.json.key_created, false);
  assert.equal(set.json.identity, undefined);
  assert.ok(!JSON.stringify(set.json).includes(CLOUD.identity));
});

/**
 * A project whose first device (example-laptop) the owner approved and which has pushed once.
 */
async function withLaptop() {
  const p = project();
  const owner = p.envOf('example-laptop', { HITLD_STORE_IDENTITY: LAPTOP.identity });
  const first = await hitld(
    ['store', 'device', 'init', '--cloud', '--name', 'example-laptop'],
    p.root,
    owner,
  );
  await hitld(['rights', 'answer', first.json.decision.decision, '--answer', 'A'], p.root, owner);
  assert.equal((await hitld(['store', 'push'], p.root, owner)).json.result, 'pushed');
  return { ...p, owner };
}

test('a second device: its request is never a recipient until an approved device asks and the owner answers', async () => {
  const p = await withLaptop();
  const joiner = p.envOf('example-tablet', { HITLD_STORE_IDENTITY: CLOUD.identity });
  const asked = await hitld(
    ['store', 'device', 'init', '--cloud', '--name', 'example-tablet'],
    p.root,
    joiner,
  );
  assert.equal(asked.code, EXIT.ok, JSON.stringify(asked.json));
  assert.equal(asked.json.decision, null, 'not the first device: it does not ask for itself');
  assert.match(asked.json.next, /hitld store device ask/);
  // Someone who can write the store repository plants a request of their own.
  plantRequest(p.host, device('example-intruder', STRANGER));
  assert.deepEqual(requestsOnHost(p.host).sort(), [
    'example-intruder',
    'example-laptop',
    'example-tablet',
  ]);

  // example-tablet may not push, and a push from example-laptop is sealed to it alone.
  await hitld(['run', 'start', '--host', 'example-tablet'], p.root, joiner);
  assert.equal((await hitld(['store', 'push'], p.root, joiner)).json.error, 'device-not-enrolled');
  p.storeOf(p.owner).write('notes/n.md', 'more\n');
  assert.equal((await hitld(['store', 'push'], p.root, p.owner)).json.recipients, 1);
  const status = await hitld(['store', 'status'], p.root, p.owner);
  assert.deepEqual(
    status.json.devices.requests.map((/** @type {any} */ d) => [d.name, d.status]),
    [
      ['example-intruder', 'requested'],
      ['example-tablet', 'requested'],
    ],
  );

  // Only an approved device asks; example-tablet is not one.
  assert.equal(
    (await hitld(['store', 'device', 'ask'], p.root, joiner)).json.error,
    'device-not-enrolled',
  );
  const ask = await hitld(['store', 'device', 'ask'], p.root, p.owner);
  assert.equal(ask.code, EXIT.ok, JSON.stringify(ask.json));
  assert.deepEqual(
    ask.json.asked.map((/** @type {any} */ a) => a.name),
    ['example-intruder', 'example-tablet'],
  );
  // Asked again, nothing new is asked.
  assert.deepEqual((await hitld(['store', 'device', 'ask'], p.root, p.owner)).json.asked, []);
  // With room in the digest for one decision, the other would take its recommendation if it
  // could; a device decision never does.
  writeSettingsFile(
    'person',
    { schema_version: 2, attention: { decisions_per_digest: 1 } },
    { env: p.owner, cwd: p.base },
  );
  const pending = await hitld(['rights', 'pending'], p.root, p.owner);
  assert.equal(pending.json.ok, true, JSON.stringify(pending.json));
  assert.equal(
    pending.json.decisions.some((/** @type {any} */ d) => d.deliver === 'default'),
    false,
    JSON.stringify(pending.json.decisions),
  );
  assert.deepEqual((await hitld(['rights', 'sweep'], p.root, p.owner)).json.applied, []);
  const [intruder, tab] = ask.json.asked;
  const no = await hitld(['rights', 'answer', intruder.decision, '--answer', 'B'], p.root, p.owner);
  assert.equal(no.json.device.event, 'refused');
  const yes = await hitld(['rights', 'answer', tab.decision, '--answer', 'A'], p.root, p.owner);
  assert.equal(yes.json.device.event, 'approved');

  const pushed = await hitld(['store', 'push'], p.root, p.owner);
  assert.equal(pushed.json.recipients, 2, JSON.stringify(pushed.json));
  const remote = createGitRemote({ url: p.url, dir: join(p.base, 'reader') });
  const bytes = await remote.fetch(/** @type {string} */ (await remote.head()));
  assert.throws(() => open(bytes, { identities: [STRANGER.identity] }), { code: 'age-no-match' });
  open(bytes, { identities: [CLOUD.identity] });
  assert.equal((await hitld(['store', 'pull'], p.root, joiner)).json.ok, true);
  const listed = await hitld(['store', 'device', 'list'], p.root, joiner);
  assert.deepEqual(
    listed.json.approved.map((/** @type {any} */ d) => d.name),
    ['example-laptop', 'example-tablet'],
  );
  assert.deepEqual(listed.json.requests, [], 'a refused key does not ask again');
  assert.equal(listed.json.this_device.enrolled, true);
});

test('device remove asks the owner; a no keeps the device, a yes removes it and the next push rotates', async () => {
  const p = await withLaptop();
  const joiner = p.envOf('example-tablet', { HITLD_STORE_IDENTITY: CLOUD.identity });
  await hitld(['store', 'device', 'init', '--cloud', '--name', 'example-tablet'], p.root, joiner);
  const ask = await hitld(['store', 'device', 'ask'], p.root, p.owner);
  await hitld(['rights', 'answer', ask.json.asked[0].decision, '--answer', 'A'], p.root, p.owner);
  assert.equal((await hitld(['store', 'push'], p.root, p.owner)).json.recipients, 2);

  assert.equal(
    (await hitld(['store', 'device', 'remove', 'nobody'], p.root, p.owner)).json.error,
    'device-unknown',
  );
  const first = await hitld(['store', 'device', 'remove', 'example-tablet'], p.root, p.owner);
  assert.equal(first.code, EXIT.ok, JSON.stringify(first.json));
  assert.equal(first.json.decision.action, 'remove');
  const no = await hitld(
    ['rights', 'answer', first.json.decision.decision, '--answer', 'B'],
    p.root,
    p.owner,
  );
  assert.equal(no.json.device.event, 'refused');
  assert.equal((await hitld(['store', 'push'], p.root, p.owner)).json.recipients, 2);

  const second = await hitld(['store', 'device', 'remove', 'example-tablet'], p.root, p.owner);
  const again = await hitld(['store', 'device', 'remove', 'example-tablet'], p.root, p.owner);
  assert.equal(again.json.decision.decision, second.json.decision.decision, 'asked once');
  const yes = await hitld(
    ['rights', 'answer', second.json.decision.decision, '--answer', 'A'],
    p.root,
    p.owner,
  );
  assert.equal(yes.json.device.event, 'removed');
  const listed = await hitld(['store', 'device', 'list'], p.root, p.owner);
  assert.deepEqual(
    listed.json.rotation.pending.map((/** @type {any} */ r) => r.name),
    ['example-tablet'],
  );
  const pushed = await hitld(['store', 'push'], p.root, p.owner);
  assert.equal(pushed.json.recipients, 1);
  assert.deepEqual(pushed.json.rotation.rotated, ['example-tablet']);
  assert.equal((await hitld(['store', 'pull'], p.root, joiner)).json.error, 'age-no-match');
});

/** What a device answer could change: the approvals, the ledger, the trust record and the tracker. @param {string} root @param {ReturnType<typeof openStore>} store */
function everythingAnAnswerChanges(root, store) {
  const items = join(root, 'work', 'items');
  return JSON.stringify({
    approvals: store.read(APPROVALS_KEY),
    ledger: store.read('ledger.jsonl'),
    trust: store.read('trust/events.jsonl'),
    items: readdirSync(items).map((f) => [f, readFileSync(join(items, f), 'utf8')]),
  });
}

test('an answer that names no option changes nothing for a device decision', async () => {
  const p = await withLaptop();
  const joiner = p.envOf('example-tablet', { HITLD_STORE_IDENTITY: CLOUD.identity });
  await hitld(['store', 'device', 'init', '--cloud', '--name', 'example-tablet'], p.root, joiner);
  const ask = await hitld(['store', 'device', 'ask'], p.root, p.owner);
  const decision = ask.json.asked[0].decision;
  const store = p.storeOf(p.owner);
  const before = everythingAnAnswerChanges(p.root, store);

  for (const answer of ['let me think about it', 'maybe, yes', 'enroll the other one', 'C']) {
    const r = await hitld(['rights', 'answer', decision, '--answer', answer], p.root, p.owner);
    assert.equal(r.code, EXIT.failed, answer);
    assert.equal(r.json.error, 'answer-matches-no-option', answer);
    assert.deepEqual(
      r.json.options.map((/** @type {any} */ o) => [o.letter, o.label]),
      [
        ['A', 'Enroll it'],
        ['B', 'Do not enroll it'],
      ],
    );
    assert.equal(r.json.device, undefined, 'no device change is reported');
    assert.equal(everythingAnAnswerChanges(p.root, store), before, `nothing changed: ${answer}`);
  }
  const waiting = await hitld(['store', 'device', 'list'], p.root, p.owner);
  assert.deepEqual(
    waiting.json.decisions.map((/** @type {any} */ d) => [d.name, d.status]),
    [['example-tablet', 'waiting-for-owner']],
  );
  assert.equal(
    (await hitld(['store', 'push'], p.root, p.owner)).json.recipients,
    1,
    'still not a recipient',
  );

  // "do not enroll it" holds the words of "enroll it" and means the opposite: it is B, not A.
  const no = await hitld(
    ['rights', 'answer', decision, '--answer', 'do not enroll it'],
    p.root,
    p.owner,
  );
  assert.equal(no.json.option, 'B', JSON.stringify(no.json));
  assert.equal(no.json.device.event, 'refused');
});

test('label words answer a device decision: "enroll it" approves, "remove it" removes, "keep it" keeps', async () => {
  const p = await withLaptop();
  const joiner = p.envOf('example-tablet', { HITLD_STORE_IDENTITY: CLOUD.identity });
  await hitld(['store', 'device', 'init', '--cloud', '--name', 'example-tablet'], p.root, joiner);
  const ask = await hitld(['store', 'device', 'ask'], p.root, p.owner);
  const yes = await hitld(
    ['rights', 'answer', ask.json.asked[0].decision, '--answer', 'enroll it'],
    p.root,
    p.owner,
  );
  assert.equal(yes.json.option, 'A', JSON.stringify(yes.json));
  assert.equal(yes.json.device.event, 'approved');
  assert.equal((await hitld(['store', 'push'], p.root, p.owner)).json.recipients, 2);

  const first = await hitld(['store', 'device', 'remove', 'example-tablet'], p.root, p.owner);
  const keep = await hitld(
    ['rights', 'answer', first.json.decision.decision, '--answer', 'Keep it'],
    p.root,
    p.owner,
  );
  assert.equal(keep.json.device.event, 'refused');
  const second = await hitld(['store', 'device', 'remove', 'example-tablet'], p.root, p.owner);
  const gone = await hitld(
    ['rights', 'answer', second.json.decision.decision, '--answer', 'remove it'],
    p.root,
    p.owner,
  );
  assert.equal(gone.json.device.event, 'removed');
});

test("a removed device's own view says it cannot open the store, not enrolled: true from its stale copy", async () => {
  const p = await withLaptop();
  const joiner = p.envOf('example-tablet', { HITLD_STORE_IDENTITY: CLOUD.identity });
  await hitld(['store', 'device', 'init', '--cloud', '--name', 'example-tablet'], p.root, joiner);
  const ask = await hitld(['store', 'device', 'ask'], p.root, p.owner);
  await hitld(['rights', 'answer', ask.json.asked[0].decision, '--answer', 'A'], p.root, p.owner);
  assert.equal((await hitld(['store', 'push'], p.root, p.owner)).json.recipients, 2);
  assert.equal((await hitld(['store', 'pull'], p.root, joiner)).json.ok, true);

  // Before the removal both devices open the head, and the second one's own copy says enrolled.
  const before = await hitld(['store', 'device', 'list'], p.root, joiner);
  assert.deepEqual(
    [before.json.this_device.enrolled, before.json.this_device.opens_remote],
    [true, true],
  );
  const beforeStatus = await hitld(['store', 'status'], p.root, joiner);
  assert.deepEqual(
    [beforeStatus.json.device.enrolled, beforeStatus.json.device.opens_remote],
    [true, true],
  );

  // The owner removes it; the first device pushes a head sealed to itself alone.
  const remove = await hitld(['store', 'device', 'remove', 'example-tablet'], p.root, p.owner);
  await hitld(
    ['rights', 'answer', remove.json.decision.decision, '--answer', 'A'],
    p.root,
    p.owner,
  );
  assert.equal((await hitld(['store', 'push'], p.root, p.owner)).json.recipients, 1);

  // The removed device's own copy still lists itself as approved. It reports what the remote says.
  const stale = await hitld(['store', 'device', 'list'], p.root, joiner);
  assert.equal(stale.code, EXIT.ok, JSON.stringify(stale.json));
  assert.equal(stale.json.this_device.enrolled, false);
  assert.equal(stale.json.this_device.opens_remote, false);
  assert.match(stale.json.this_device.problem, /cannot open the store/);
  assert.match(stale.json.this_device.problem, /probably removed/);
  const status = await hitld(['store', 'status'], p.root, joiner);
  assert.equal(status.json.device.enrolled, false);
  assert.equal(status.json.device.opens_remote, false);
  assert.match(status.json.device.problem, /cannot open the store/);
  assert.ok(
    status.json.problems.some((/** @type {string} */ m) => /cannot open the store/.test(m)),
  );
  assert.doesNotMatch(JSON.stringify(stale.json), /AGE-SECRET-KEY/);

  // The device that stays still sees itself as enrolled.
  const mine = await hitld(['store', 'device', 'list'], p.root, p.owner);
  assert.deepEqual(
    [mine.json.this_device.enrolled, mine.json.this_device.opens_remote],
    [true, true],
  );

  // A device the head is not sealed to, because no approved device has pushed since its approval,
  // gets the same words.
  const third = p.envOf('example-cloud-2', { HITLD_STORE_IDENTITY: GPU.identity });
  await hitld(['store', 'device', 'init', '--cloud', '--name', 'example-cloud-2'], p.root, third);
  const asked = await hitld(['store', 'device', 'ask'], p.root, p.owner);
  const thirdAsk = asked.json.asked.find((/** @type {any} */ a) => a.name === 'example-cloud-2');
  await hitld(['rights', 'answer', thirdAsk.decision, '--answer', 'A'], p.root, p.owner);
  const unsealed = await hitld(['store', 'device', 'list'], p.root, third);
  assert.equal(unsealed.json.this_device.opens_remote, false);
  assert.equal(unsealed.json.this_device.enrolled, false);
  assert.match(unsealed.json.this_device.problem, /cannot open the store/);
});

test('a store from before device decisions: a key that opens the head, in a store with no approval, asks for itself', async () => {
  const p = project();
  // The remote's head was sealed to example-laptop and another device under the old device list.
  const env = p.envOf('example-laptop', { HITLD_STORE_IDENTITY: LAPTOP.identity });
  const old = p.storeOf(env);
  old.write('notes/n.md', 'from before\n');
  const { openRemote, pushStore } = await import('../lib/store/push-pull.mjs');
  const { remote, url } = openRemote(old.root, { url: p.url, source: 'environment' });
  const sealedTo = resolveDevices({ store: old, env });
  const legacy = {
    ...sealedTo,
    enrolled: true,
    device: 'example-laptop',
    recipients: [LAPTOP.recipient, GPU.recipient],
  };
  assert.equal(
    (await pushStore({ root: old.root, projectId: 'fixture', remote, url, devices: legacy }))
      .result,
    'pushed',
  );

  // A fresh container with example-laptop's key opens that head, finds no approval, and asks.
  const fresh = p.envOf('fresh', { HITLD_STORE_IDENTITY: LAPTOP.identity });
  const asked = await hitld(
    ['store', 'device', 'init', '--cloud', '--name', 'example-laptop'],
    p.root,
    fresh,
  );
  assert.equal(asked.code, EXIT.ok, JSON.stringify(asked.json));
  assert.match(String(asked.json.decision?.decision), /^W-\d+$/);
  assert.equal(p.storeOf(fresh).read('notes/n.md'), 'from before\n', 'the head was merged first');
  // A key that does not open it is a new device: it waits for an approved one to ask.
  const other = p.envOf('other', { HITLD_STORE_IDENTITY: CLOUD.identity });
  const waits = await hitld(
    ['store', 'device', 'init', '--cloud', '--name', 'other'],
    p.root,
    other,
  );
  assert.equal(waits.json.decision, null);
});

test('executors are refused every device command', async () => {
  const p = project();
  for (const argv of [
    ['store', 'device', 'init', '--name', 'x'],
    ['store', 'device', 'init', '--cloud', '--name', 'x'],
    ['store', 'device', 'ask'],
    ['store', 'device', 'list'],
    ['store', 'device', 'remove', 'example-laptop'],
  ]) {
    for (const extra of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-3' }]) {
      const out = await hitld(argv, p.root, p.envOf('x', extra));
      assert.equal(out.json.error, 'not-permitted', argv.join(' '));
      assert.equal(out.code, EXIT.failed);
    }
  }
  assert.deepEqual(requestsOnHost(p.host), [], 'no request reached the store repository');

  // From a linked worktree too, where executors work.
  const wt = join(p.base, 'wt');
  fixtureGit(p.root, 'worktree', 'add', '-q', '-b', 'W-2', wt);
  const linked = await hitld(['store', 'device', 'list'], wt, p.envOf('x'));
  assert.equal(linked.json.error, 'not-permitted');
});

// --- the device list never goes in the project's repository ------------------------------------

test("a device list in the project's repository: refused at commit, by the policy check and at merge", async () => {
  const p = project();
  const listed = devicesText(device('mine', STRANGER));
  putFiles(p.root, { '.human-in-the-lead/store-devices.json': listed });
  fixtureGit(p.root, 'add', '.human-in-the-lead/store-devices.json');
  const staged = await hitld(['check', 'classification', '--staged'], p.root, p.envOf('x'));
  assert.equal(staged.json.ok, false);
  assert.deepEqual(
    staged.json.refused.map((/** @type {any} */ r) => r.rule),
    ['store-devices'],
  );
  assert.match(staged.json.message, /address or device list/);
  const policy = await hitld(['check', 'policy'], p.root, p.envOf('x'));
  assert.equal(policy.json.ok, false);
  assert.match(policy.json.errors.at(-1).message, /hitld store device init/);
  const list = await hitld(['store', 'device', 'list'], p.root, p.envOf('x'));
  assert.match(list.json.warnings.join(), /is not read any more/);
  fixtureGit(p.root, 'reset', '-q');
  rmSync(join(p.root, '.human-in-the-lead', 'store-devices.json'));

  // A branch that brings it is sent back by the merge's own guard.
  putFiles(p.root, { 'suite.mjs': 'process.exit(0)\n' });
  commitAll(p.root, 'suite');
  fixtureGit(p.root, 'switch', '-q', '-c', 'W-1');
  putFiles(p.root, { '.human-in-the-lead/store-devices.json': listed });
  commitAll(p.root, 'add a device list');
  fixtureGit(p.root, 'switch', '-q', 'main');
  const before = fixtureGit(p.root, 'rev-parse', 'main');
  const q = await runMergeQueue({
    repoRoot: p.root,
    entries: [{ item: 'W-1', branch: 'W-1' }],
    settings: {
      mainBranch: 'main',
      batchMax: 4,
      fastChecks: [],
      fullSuite: ['node suite.mjs'],
      generated: [],
      flakeReruns: 0,
    },
  });
  assert.deepEqual(
    q.rejected.map((x) => [x.item, x.reason, x.files]),
    [['W-1', 'classification', ['.human-in-the-lead/store-devices.json']]],
  );
  assert.equal(fixtureGit(p.root, 'rev-parse', 'main'), before);
});

test('a device answer applies only to the device decision asked under its ID, never to another filed there', async () => {
  const p = await withLaptop();
  const joiner = p.envOf('example-tablet', { HITLD_STORE_IDENTITY: CLOUD.identity });
  await hitld(['store', 'device', 'init', '--cloud', '--name', 'example-tablet'], p.root, joiner);
  const ask = await hitld(['store', 'device', 'ask'], p.root, p.owner);
  const asked = ask.json.asked[0];
  assert.match(asked.check, /^[0-9a-f]{8}$/);
  assert.match(asked.text, new RegExp(`Check code: ${asked.check}`));
  assert.equal(
    asked.answer_with,
    `hitld rights answer ${asked.decision} --answer A --code ${asked.check}`,
  );
  const store = p.storeOf(p.owner);
  // Another session filed a removal of example-laptop under the same ID, from its own copy of main.
  const laptop = approvedDevices(readApprovals(store)).find((d) => d.name === 'example-laptop');
  recordApproval(store, {
    event: 'asked',
    decision: asked.decision,
    action: 'remove',
    name: 'example-laptop',
    recipient: /** @type {any} */ (laptop).recipient,
    at: '2026-11-15T12:30:00.000Z',
  });

  // The answer is for the question shown: enroll example-tablet. The removal is not applied.
  const yes = await hitld(
    ['rights', 'answer', asked.decision, '--answer', 'A', '--code', asked.check],
    p.root,
    p.owner,
  );
  assert.equal(yes.code, EXIT.ok, JSON.stringify(yes.json));
  assert.deepEqual([yes.json.device.event, yes.json.device.name], ['approved', 'example-tablet']);
  assert.match(yes.json.warnings.join(), /another_question_under_this_id/);
  assert.deepEqual(
    approvedDevices(readApprovals(store)).map((d) => d.name),
    ['example-laptop', 'example-tablet'],
    'example-laptop was not removed',
  );
  // The other question is asked again, under an ID of its own.
  const again = await hitld(['store', 'device', 'remove', 'example-laptop'], p.root, p.owner);
  assert.equal(again.code, EXIT.ok, JSON.stringify(again.json));
  assert.notEqual(again.json.decision.decision, asked.decision);
  assert.deepEqual(
    openDeviceAsks(readApprovals(store)).map((r) => [r.decision, r.action, r.name]),
    [[again.json.decision.decision, 'remove', 'example-laptop']],
  );
});

test('an answer to a device decision whose question changed under the same ID is refused and changes nothing', async () => {
  const p = await withLaptop();
  const joiner = p.envOf('example-tablet', { HITLD_STORE_IDENTITY: CLOUD.identity });
  await hitld(['store', 'device', 'init', '--cloud', '--name', 'example-tablet'], p.root, joiner);
  const ask = await hitld(['store', 'device', 'ask'], p.root, p.owner);
  const asked = ask.json.asked[0];
  const shown = await hitld(['rights', 'show', asked.decision], p.root, p.owner);
  assert.equal(shown.json.check, asked.check);
  const store = p.storeOf(p.owner);
  const before = everythingAnAnswerChanges(p.root, store);

  // A code from another question is refused.
  const other = await hitld(
    ['rights', 'answer', asked.decision, '--answer', 'A', '--code', 'ffffffff'],
    p.root,
    p.owner,
  );
  assert.equal(other.code, EXIT.failed);
  assert.equal(other.json.error, 'answer-question-changed');
  assert.equal(other.json.device, undefined);
  assert.equal(everythingAnAnswerChanges(p.root, store), before);

  // The tracker item under the ID becomes another session's question (a removal): refused, even
  // with the right code, since the item is not the question asked.
  const items = join(p.root, 'work', 'items');
  const file = readdirSync(items).find((f) => f.startsWith(`${asked.decision}-`));
  const path = join(items, /** @type {string} */ (file));
  writeFileSync(
    path,
    readFileSync(path, 'utf8')
      .replace('Approve a store device', 'Remove a store device')
      .replace('Enroll the store device', 'Remove the store device'),
  );
  const changed = everythingAnAnswerChanges(p.root, store);
  const r = await hitld(
    ['rights', 'answer', asked.decision, '--answer', 'A', '--code', asked.check],
    p.root,
    p.owner,
  );
  assert.equal(r.json.error, 'answer-question-changed', JSON.stringify(r.json));
  assert.match(r.json.message, /title is "Remove a store device"/);
  assert.equal(everythingAnAnswerChanges(p.root, store), changed, 'nothing recorded');
  assert.deepEqual(
    approvedDevices(readApprovals(store)).map((d) => d.name),
    ['example-laptop'],
  );
});
