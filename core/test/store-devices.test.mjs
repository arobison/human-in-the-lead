// Store devices (design 0003, sections 5, 6 and 9): store-devices.json and its check, the list on
// main, the device port a push asks, rotation after a removal (milestone c3), the commands, and
// the merge queue's refusal of a branch that changes the list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, EXIT } from '../lib/cli/main.mjs';
import { generateIdentity, recipientOf } from '../lib/store/age.mjs';
import { open, seal } from '../lib/store/sealed.mjs';
import { openStore } from '../lib/store/store.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { commitAll, fixtureGit, putFiles } from '../lib/eval/orchestrator-fixtures.mjs';
import { memoryRemote } from './helpers/memory-remote.mjs';
import { keychain } from '../lib/env/keychain.mjs';
import {
  DEVICES_PATH,
  DevicesError,
  ROTATIONS_KEY,
  addDevice,
  checkDevices,
  emptyDevices,
  enrolledOnMain,
  nameFromHost,
  pendingRotations,
  readRotations,
  recordRotation,
  removeDevice,
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

/** A repository on main with a policy.json, and a private store outside it. */
function repo() {
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
    'README.md': 'a project\n',
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAll(root, 'start');
  const store = openStore(join(base, 'store'));
  /** @param {string} text @param {string} [message] */
  const commitDevices = (text, message = 'devices') => {
    putFiles(root, { [DEVICES_PATH]: text });
    return commitAll(root, message);
  };
  return { base, root, store, commitDevices };
}

/** A keychain stand-in. @param {string | null} value */
const fakeKeychain = (value) => ({ read: () => value });

/** @param {{ root: string, store: import('../lib/store/store.mjs').PrivateStore }} r @param {NodeJS.ProcessEnv} env */
const resolve = (r, env) =>
  resolveDevices({ root: r.root, store: r.store, env, keychain: fakeKeychain(null) });

// --- the file ----------------------------------------------------------------------------------

test('store-devices.json: public keys, names and dates only; names and keys unique; keys checked', () => {
  const ok = checkDevices(devicesText(device('laptop', LAPTOP), device('cloud-main', CLOUD)));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.file?.devices.length, 2);

  const twice = checkDevices(devicesText(device('laptop', LAPTOP), device('laptop', CLOUD)));
  assert.match(twice.problems.join(), /the name "laptop" appears twice/);
  const sameKey = checkDevices(devicesText(device('laptop', LAPTOP), device('other', LAPTOP)));
  assert.match(sameKey.problems.join(), /enrolled twice/);

  // A private key, or anything else, is not a key the file may hold.
  const secret = checkDevices(
    JSON.stringify({
      schema_version: 1,
      devices: [{ name: 'laptop', recipient: LAPTOP.identity, added: DAY }],
    }),
  );
  assert.match(secret.problems.join(), /recipient/);
  assert.doesNotMatch(secret.problems.join(), /AGE-SECRET-KEY/);
  const extra = checkDevices(
    JSON.stringify({
      schema_version: 1,
      devices: [{ ...device('laptop', LAPTOP), identity: 'x' }],
    }),
  );
  assert.match(extra.problems.join(), /identity: is not a known key/);

  // A key with a broken checksum passes the pattern and fails the check.
  const last = LAPTOP.recipient.at(-1) === 'q' ? 'p' : 'q';
  const broken = checkDevices(
    devicesText({ name: 'laptop', recipient: LAPTOP.recipient.slice(0, -1) + last, added: DAY }),
  );
  assert.match(broken.problems.join(), /not an age public key/);

  assert.match(
    checkDevices(JSON.stringify({ schema_version: 2, devices: [] })).problems.join(),
    /newer than this release knows/,
  );
  assert.match(checkDevices('{').problems.join(), /does not parse/);
});

test('add and remove: sorted output, the same key twice changes nothing, a taken name is refused', () => {
  let file = emptyDevices();
  ({ file } = addDevice(file, device('zeta', CLOUD)));
  ({ file } = addDevice(file, device('alpha', LAPTOP)));
  const text = serializeDevices(file);
  assert.ok(text.indexOf('"alpha"') < text.indexOf('"zeta"'));
  assert.ok(text.endsWith('}\n'));

  const again = addDevice(file, device('alpha', LAPTOP));
  assert.equal(again.changed, false);
  const renamed = addDevice(file, device('beta', LAPTOP));
  assert.equal(renamed.changed, false, 'a key already enrolled is not enrolled twice');
  assert.equal(renamed.entry.name, 'alpha');
  assert.throws(
    () => addDevice(file, device('alpha', GPU)),
    (e) => e instanceof DevicesError && e.code === 'device-name-taken',
  );
  assert.throws(
    () => addDevice(file, device('Bad Name', GPU)),
    (e) => e instanceof DevicesError && e.code === 'device-name-invalid',
  );

  const { file: left, removed } = removeDevice(file, 'zeta');
  assert.equal(removed.recipient, CLOUD.recipient);
  assert.deepEqual(
    left.devices.map((d) => d.name),
    ['alpha'],
  );
  assert.throws(
    () => removeDevice(left, 'zeta'),
    (e) => e instanceof DevicesError && e.code === 'device-unknown',
  );
  assert.equal(nameFromHost('Owners-MacBook-Pro.local'), 'owners-macbook-pro');
  assert.equal(nameFromHost('---'), null);
});

// --- main's list -------------------------------------------------------------------------------

test("the enrolled set is main's committed list: not the working tree, not another branch", () => {
  const r = repo();
  assert.deepEqual(enrolledOnMain(r.root, 'main').devices, [], 'no file on main: nobody');
  r.commitDevices(devicesText(device('laptop', LAPTOP)));

  // An uncommitted edit does not enrol.
  putFiles(r.root, { [DEVICES_PATH]: devicesText(device('laptop', LAPTOP), device('gpu', GPU)) });
  assert.deepEqual(
    enrolledOnMain(r.root, 'main').devices.map((d) => d.name),
    ['laptop'],
  );
  // Nor does a commit on a branch.
  fixtureGit(r.root, 'switch', '-q', '-c', 'W-1');
  commitAll(r.root, 'enrol on a branch');
  assert.deepEqual(
    enrolledOnMain(r.root, 'main').devices.map((d) => d.name),
    ['laptop'],
  );
  fixtureGit(r.root, 'switch', '-q', 'main');
  assert.deepEqual(enrolledOnMain(r.root, 'main').refs, ['refs/heads/main']);
});

test('with a local main and origin/main, a device counts only if both list it', () => {
  const r = repo();
  const both = r.commitDevices(devicesText(device('laptop', LAPTOP), device('gpu', GPU)));
  fixtureGit(r.root, 'update-ref', 'refs/remotes/origin/main', both);
  // The owner removed gpu on the remote's main; this checkout's local main has not caught up.
  r.commitDevices(devicesText(device('laptop', LAPTOP)), 'remove gpu');
  const removedOnRemote = fixtureGit(r.root, 'rev-parse', 'HEAD');
  fixtureGit(r.root, 'reset', '-q', '--hard', both);
  fixtureGit(r.root, 'update-ref', 'refs/remotes/origin/main', removedOnRemote);
  const on = enrolledOnMain(r.root, 'main');
  assert.deepEqual(on.refs, ['refs/heads/main', 'refs/remotes/origin/main']);
  assert.deepEqual(
    on.devices.map((d) => d.name),
    ['laptop'],
  );
});

test("a list on main that fails the check enrols nobody; a checkout without main can't tell", () => {
  const r = repo();
  r.commitDevices('{"schema_version": 1, "devices": [{"name": "x"}]}');
  assert.throws(
    () => enrolledOnMain(r.root, 'main'),
    (e) => e instanceof DevicesError && e.code === 'devices-invalid',
  );
  assert.throws(
    () => enrolledOnMain(r.root, 'trunk'),
    (e) => e instanceof DevicesError && e.code === 'devices-no-main',
  );
});

// --- the port ----------------------------------------------------------------------------------

test('the port: recipients from main, the identity from the environment or the keychain', () => {
  const r = repo();
  r.commitDevices(devicesText(device('laptop', LAPTOP), device('cloud-main', CLOUD)));

  const cloud = resolve(r, { HITLD_STORE_IDENTITY: CLOUD.identity });
  assert.deepEqual(cloud.recipients.sort(), [CLOUD.recipient, LAPTOP.recipient].sort());
  assert.equal(cloud.identity, CLOUD.identity);
  assert.equal(cloud.enrolled, true);
  assert.equal(cloud.device, 'cloud-main');
  assert.equal(cloud.key_source, 'environment');
  assert.equal(assertEnrolled(cloud).device, 'cloud-main');

  const local = resolveDevices({
    root: r.root,
    store: r.store,
    env: {},
    keychain: fakeKeychain(LAPTOP.identity),
  });
  assert.equal(local.device, 'laptop');
  assert.equal(local.key_source, 'keychain');

  // Several keys in the variable: the one on the list is this device's.
  const several = resolve(r, {
    HITLD_STORE_IDENTITY: `# another project\n${STRANGER.identity}\n${CLOUD.identity}\n`,
  });
  assert.equal(several.identity, CLOUD.identity);
  assert.equal(several.device, 'cloud-main');
});

test('a push from a device not on main is refused by name: device-not-enrolled', () => {
  const r = repo();
  r.commitDevices(devicesText(device('laptop', LAPTOP)));
  /** @param {ReturnType<typeof resolveDevices>} res */
  const refused = (res) =>
    assert.throws(
      () => assertEnrolled(res),
      (e) => e instanceof DevicesError && e.code === 'device-not-enrolled',
    );

  const stranger = resolve(r, { HITLD_STORE_IDENTITY: STRANGER.identity });
  assert.equal(stranger.enrolled, false);
  assert.equal(stranger.device, null);
  assert.match(String(stranger.problem), new RegExp(STRANGER.recipient));
  refused(stranger);

  const none = resolve(r, {});
  assert.equal(none.identity, null);
  assert.match(String(none.problem), /no key/);
  refused(none);

  const bad = resolve(r, { HITLD_STORE_IDENTITY: 'AGE-SECRET-KEY-1NOTAKEY' });
  assert.equal(bad.identity, null);
  assert.doesNotMatch(String(bad.problem), /NOTAKEY/);
  refused(bad);

  // Enrolled in the working tree only: still refused.
  putFiles(r.root, {
    [DEVICES_PATH]: devicesText(device('laptop', LAPTOP), device('x', STRANGER)),
  });
  refused(resolve(r, { HITLD_STORE_IDENTITY: STRANGER.identity }));
});

// --- rotation: milestone c3 --------------------------------------------------------------------

test('c3: after a removal reaches main, nothing pushed opens with the removed key, and older files are pruned', async () => {
  const r = repo();
  r.commitDevices(devicesText(device('laptop', LAPTOP), device('gpu', GPU)));
  const remote = memoryRemote().open();
  const manifest = {
    project: 'fixture',
    schema_versions: {},
    head: '0'.repeat(40),
    branch: 'main',
    created_at: '2026-11-15T10:00:00.000Z',
    hitld_version: 'test',
  };
  /** A push as store push makes it: refuse an unenrolled device, encrypt to main's list. */
  const push = async (/** @type {string} */ text) => {
    const res = assertEnrolled(resolve(r, { HITLD_STORE_IDENTITY: LAPTOP.identity }));
    const bytes = seal(manifest, Buffer.from(text), res.recipients);
    const version = await remote.push(bytes, { expected: await remote.head() });
    return {
      version,
      rotation: await completeRotation({ remote, store: r.store, resolution: res, version }),
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

  // The owner removes gpu; it counts once the commit is on main.
  r.commitDevices(devicesText(device('laptop', LAPTOP)), 'remove gpu');
  const pending = resolve(r, {}).rotation.pending;
  assert.deepEqual(
    pending.map((p) => p.name),
    ['gpu'],
  );

  const second = await push('after the removal');
  assert.equal(await opens(GPU, second.version), false, 'not encrypted to the removed key');
  assert.equal(await opens(LAPTOP, second.version), true);
  assert.deepEqual(second.rotation, { rotated: ['gpu'], removed: [first.version] });
  // The remote holds nothing the removed key opens.
  assert.equal(await remote.head(), second.version);
  await assert.rejects(remote.fetch(first.version), /no v1/);
  assert.deepEqual(
    readRotations(r.store).map((x) => [x.event, x.name]),
    [['rotated', 'gpu']],
  );

  // Done once: the next push prunes nothing.
  assert.deepEqual(resolve(r, {}).rotation.pending, []);
  const third = await push('later');
  assert.deepEqual(third.rotation, { rotated: [], removed: [] });
  assert.equal(await opens(GPU, third.version), false);
});

test('a removal is pending until rotated after it; enrolled again and removed again, it is pending again', () => {
  const at = (/** @type {number} */ h) => `2026-11-15T${String(h).padStart(2, '0')}:00:00Z`;
  const removal = { name: 'gpu', recipient: GPU.recipient, at: at(10), commit: 'abc1234' };
  assert.deepEqual(
    pendingRotations({ removals: [removal], records: [], current: [LAPTOP.recipient] }),
    [removal],
  );
  // Still on main: not pending, whatever the store says.
  assert.deepEqual(
    pendingRotations({ removals: [removal], records: [], current: [GPU.recipient] }),
    [],
  );
  const rotated = /** @type {const} */ ({
    event: 'rotated',
    name: 'gpu',
    recipient: GPU.recipient,
    at: at(11),
    version: 'v2',
  });
  assert.deepEqual(pendingRotations({ removals: [removal], records: [rotated], current: [] }), []);
  const again = { ...removal, at: at(12), commit: 'def5678' };
  assert.deepEqual(
    pendingRotations({ removals: [removal, again], records: [rotated], current: [] }),
    [again],
  );
  // A removal recorded by `device remove` counts too, once the key is off main.
  const recorded = /** @type {const} */ ({
    event: 'removed',
    name: 'gpu',
    recipient: GPU.recipient,
    at: at(9),
  });
  assert.equal(pendingRotations({ removals: [], records: [recorded], current: [] }).length, 1);
});

test('rotation records are append-only lines in the private store; a bad line is skipped', () => {
  const store = openStore(mkdtempSync(join(tmpdir(), 'hitld-rot-')));
  recordRotation(store, { event: 'removed', name: 'gpu', recipient: GPU.recipient, at: DAY });
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

test(
  'device init on a local machine: the private key goes to the keychain, never a file, an argument or the output',
  { skip: !keychainTests && 'no keychain tool on this platform' },
  async () => {
    const r = repo();
    const kc = fakeKeychainTools(r.base);
    const env = { PATH: kc.PATH, XDG_DATA_HOME: join(r.base, 'data') };
    const out = await hitld(['store', 'device', 'init', '--name', 'laptop'], r.root, env);
    assert.equal(out.code, EXIT.ok, JSON.stringify(out.json));
    assert.equal(out.json.device, 'laptop');
    assert.equal(out.json.changed, true);
    assert.equal(out.json.key_created, true);
    assert.deepEqual(out.json.key, {
      where: 'keychain',
      service: 'hitld-store-fixture',
      account: 'device-identity',
    });
    assert.equal(out.json.identity, undefined, 'a local key is never printed');
    assert.match(out.json.next, /commit \.human-in-the-lead\/store-devices\.json/);

    const stored = readdirSync(kc.vault);
    assert.deepEqual(stored, ['hitld-store-fixture__device-identity']);
    const identity = readFileSync(join(kc.vault, stored[0]), 'utf8').trim();
    assert.equal(recipientOf(identity), out.json.recipient);
    assert.ok(!readFileSync(kc.log, 'utf8').includes(identity), 'the key never went on argv');
    assert.ok(!JSON.stringify(out.json).includes(identity));
    const file = checkDevices(readFileSync(join(r.root, DEVICES_PATH), 'utf8'));
    assert.deepEqual(file.file?.devices, [
      { name: 'laptop', recipient: out.json.recipient, added: '2026-11-15' },
    ]);

    // Again: the same key, nothing changes.
    const again = await hitld(['store', 'device', 'init', '--name', 'laptop'], r.root, env);
    assert.equal(again.json.changed, false);
    assert.equal(again.json.key_created, false);
    assert.equal(again.json.recipient, out.json.recipient);

    // list reads main: the uncommitted entry is not enrolled yet.
    const before = await hitld(['store', 'device', 'list'], r.root, env);
    assert.equal(before.code, EXIT.ok, JSON.stringify(before.json));
    assert.deepEqual(before.json.devices, []);
    assert.deepEqual(
      before.json.not_on_main.added.map((/** @type {{ name: string }} */ d) => d.name),
      ['laptop'],
    );
    assert.equal(before.json.this_device.enrolled, false);
    commitAll(r.root, 'enrol laptop');
    const after = await hitld(['store', 'device', 'list'], r.root, env);
    assert.deepEqual(
      after.json.devices.map((/** @type {{ name: string }} */ d) => d.name),
      ['laptop'],
    );
    assert.deepEqual(after.json.this_device, {
      name: 'laptop',
      enrolled: true,
      key_source: 'keychain',
    });
  },
);

test('device init: a taken name is refused before any key is made; no keychain is refused with a way on', async () => {
  const r = repo();
  r.commitDevices(devicesText(device('laptop', LAPTOP)));
  const kc = fakeKeychainTools(r.base);
  const env = { PATH: kc.PATH, XDG_DATA_HOME: join(r.base, 'data') };
  const taken = await hitld(['store', 'device', 'init', '--name', 'laptop'], r.root, env);
  assert.equal(taken.json.error, 'device-name-taken');
  assert.deepEqual(readdirSync(kc.vault), [], 'no orphan key');

  const empty = join(r.base, 'empty-bin');
  mkdirSync(empty);
  const none = await hitld(['store', 'device', 'init', '--name', 'desk'], r.root, {
    PATH: empty,
    XDG_DATA_HOME: join(r.base, 'data'),
  });
  assert.equal(none.code, EXIT.failed);
  assert.equal(none.json.error, 'device-no-keychain');
  assert.match(none.json.message, /--cloud/);
  assert.match(none.json.message, /HITLD_STORE_IDENTITY/);

  const badName = await hitld(['store', 'device', 'init', '--name', 'My Laptop'], r.root, env);
  assert.equal(badName.json.error, 'device-name-invalid');
});

test('device init --cloud: the key is printed once for the environment variable, and written nowhere', async () => {
  const r = repo();
  const kc = fakeKeychainTools(r.base);
  const env = { PATH: kc.PATH, XDG_DATA_HOME: join(r.base, 'data') };
  const unnamed = await hitld(['store', 'device', 'init', '--cloud'], r.root, env);
  assert.equal(unnamed.json.error, 'device-name-required');

  const out = await hitld(
    ['store', 'device', 'init', '--cloud', '--name', 'cloud-main'],
    r.root,
    env,
  );
  assert.equal(out.code, EXIT.ok, JSON.stringify(out.json));
  assert.deepEqual(out.json.key, { where: 'environment', variable: 'HITLD_STORE_IDENTITY' });
  assert.equal(recipientOf(out.json.identity), out.json.recipient);
  assert.match(out.json.message, /does not show it again/);
  assert.match(out.json.next, /^set HITLD_STORE_IDENTITY/);
  assert.deepEqual(readdirSync(kc.vault), [], 'nothing in the keychain');
  assert.deepEqual(filesHolding(r.base, out.json.identity), [], 'nothing on disk');
  const text = readFileSync(join(r.root, DEVICES_PATH), 'utf8');
  assert.ok(!text.includes('AGE-SECRET-KEY'), 'the file holds the public key only');
  assert.match(text, /"cloud-main"/);

  // In the environment, with the variable set: enrol that key, print nothing secret.
  const r2 = repo();
  const set = await hitld(['store', 'device', 'init', '--cloud', '--name', 'cloud-main'], r2.root, {
    PATH: kc.PATH,
    HITLD_STORE_IDENTITY: CLOUD.identity,
  });
  assert.equal(set.code, EXIT.ok, JSON.stringify(set.json));
  assert.equal(set.json.recipient, CLOUD.recipient);
  assert.equal(set.json.key_created, false);
  assert.equal(set.json.identity, undefined);
  assert.ok(!JSON.stringify(set.json).includes(CLOUD.identity));
});

test('device remove: edits the file for the owner to commit, and records that the key must rotate', async () => {
  const r = repo();
  r.commitDevices(devicesText(device('laptop', LAPTOP), device('gpu', GPU)));
  const env = { PATH: process.env.PATH, XDG_DATA_HOME: join(r.base, 'data') };
  const store = join(r.base, 'store');
  const out = await hitld(['store', 'device', 'remove', 'gpu', '--store', store], r.root, env);
  assert.equal(out.code, EXIT.ok, JSON.stringify(out.json));
  assert.equal(out.json.removed.name, 'gpu');
  assert.equal(out.json.remaining, 1);
  assert.equal(out.json.rotation, 'pending');
  assert.match(out.json.message, /encrypted only to the remaining devices/);
  assert.deepEqual(
    checkDevices(readFileSync(join(r.root, DEVICES_PATH), 'utf8')).file?.devices.map((d) => d.name),
    ['laptop'],
  );
  assert.deepEqual(
    readRotations(openStore(store)).map((x) => [x.event, x.name, x.recipient]),
    [['removed', 'gpu', GPU.recipient]],
  );

  // Not on main yet: still enrolled, still a recipient, nothing pending.
  const list = await hitld(['store', 'device', 'list', '--store', store], r.root, env);
  assert.deepEqual(
    list.json.devices.map((/** @type {{ name: string }} */ d) => d.name),
    ['gpu', 'laptop'],
  );
  assert.deepEqual(
    list.json.not_on_main.removed.map((/** @type {{ name: string }} */ d) => d.name),
    ['gpu'],
  );
  assert.deepEqual(list.json.rotation.pending, []);
  commitAll(r.root, 'remove gpu');
  const merged = await hitld(['store', 'device', 'list', '--store', store], r.root, env);
  assert.deepEqual(
    merged.json.rotation.pending.map((/** @type {{ name: string }} */ p) => p.name),
    ['gpu'],
  );

  const unknown = await hitld(['store', 'device', 'remove', 'gpu', '--store', store], r.root, env);
  assert.equal(unknown.json.error, 'device-unknown');
});

test('executors are refused every device command', async () => {
  const r = repo();
  r.commitDevices(devicesText(device('laptop', LAPTOP)));
  for (const argv of [
    ['store', 'device', 'init', '--name', 'x'],
    ['store', 'device', 'init', '--cloud', '--name', 'x'],
    ['store', 'device', 'list'],
    ['store', 'device', 'remove', 'laptop'],
  ]) {
    for (const env of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-3' }]) {
      const out = await hitld(argv, r.root, { PATH: process.env.PATH, ...env });
      assert.equal(out.json.error, 'not-permitted', argv.join(' '));
      assert.equal(out.code, EXIT.failed);
    }
  }
  // Nothing changed.
  assert.equal(
    readFileSync(join(r.root, DEVICES_PATH), 'utf8'),
    devicesText(device('laptop', LAPTOP)),
  );

  // From a linked worktree too, where executors work.
  const wt = join(r.base, 'wt');
  fixtureGit(r.root, 'worktree', 'add', '-q', '-b', 'W-2', wt);
  const linked = await hitld(['store', 'device', 'list'], wt, { PATH: process.env.PATH });
  assert.equal(linked.json.error, 'not-permitted');
});

// --- the merge queue ---------------------------------------------------------------------------

test('the merge queue sends back a branch that changes store-devices.json', async () => {
  const r = repo();
  putFiles(r.root, { 'suite.mjs': 'process.exit(0)\n' });
  commitAll(r.root, 'suite');
  fixtureGit(r.root, 'switch', '-q', '-c', 'W-1');
  putFiles(r.root, { [DEVICES_PATH]: devicesText(device('mine', STRANGER)) });
  commitAll(r.root, 'enrol a device');
  fixtureGit(r.root, 'switch', '-q', 'main');
  const before = fixtureGit(r.root, 'rev-parse', 'main');
  const q = await runMergeQueue({
    repoRoot: r.root,
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
    [['W-1', 'store-devices', [DEVICES_PATH]]],
  );
  assert.match(String(q.rejected[0].message), /Only the owner enrols or removes a store device/);
  assert.equal(fixtureGit(r.root, 'rev-parse', 'main'), before);
});
