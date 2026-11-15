import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, EXIT } from '../lib/cli/main.mjs';
import { openStore } from '../lib/store/store.mjs';
import { appendEvent } from '../lib/ledger/ledger.mjs';
import { generateIdentity } from '../lib/store/age.mjs';
import { open } from '../lib/store/sealed.mjs';
import { git, head, snapshot } from '../lib/store/git.mjs';
import { createGitRemote, remoteDir } from '../lib/store/remote-git.mjs';
import { pushStore, storeStatus } from '../lib/store/push-pull.mjs';
import { resolveDevices } from '../lib/store/devices-port.mjs';
import { DEVICES_PATH, readRotations, serializeDevices } from '../lib/store/devices.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { commitAll, fixtureGit, putFiles } from '../lib/eval/orchestrator-fixtures.mjs';

/** Two enrolled devices and one that is not. */
const DEVICE_A = generateIdentity();
const DEVICE_B = generateIdentity();
const STRANGER = generateIdentity();
const at = (/** @type {number} */ n) => `2026-11-14T10:${String(n).padStart(2, '0')}:00.000Z`;

/** Strings of the fixture store that must never appear in the remote. */
const SECRET_NOTE = 'the cache eviction rationale is confidential: tenant 4471 asked for it';

/**
 * Put a store address in the project's policy.json, as a project from before HITLD-113 has it.
 * @param {ReturnType<typeof fixture>} f @param {string | null} url
 */
function setPolicyUrl(f, url) {
  writeFileSync(
    join(f.project, '.human-in-the-lead', 'policy.json'),
    JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
      store: { remote: { url } },
    }),
  );
}

/**
 * Another bare repository standing in for a second host.
 * @param {ReturnType<typeof fixture>} f @param {string} name
 */
function otherHost(f, name) {
  const bare = join(f.dir, 'host', name);
  mkdirSync(bare, { recursive: true });
  const init = spawnSync('git', ['init', '-q', '--bare'], { cwd: bare, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return { bare, url: `file://${bare}` };
}

/**
 * A project checkout whose main enrols devices A and B in store-devices.json, with an origin it
 * was pushed to; a bare repository standing in for the store's host; and stores.
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-push-pull-'));
  const project = join(dir, 'project');
  mkdirSync(project);
  fixtureGit(project, 'init', '-q', '-b', 'main');
  fixtureGit(project, 'config', 'user.name', 'Fixture');
  fixtureGit(project, 'config', 'user.email', 'fixture@example.invalid');
  fixtureGit(project, 'config', 'commit.gpgsign', 'false');
  putFiles(project, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
    }),
    [DEVICES_PATH]: devicesFile(['device-a', DEVICE_A], ['device-b', DEVICE_B]),
  });
  commitAll(project, 'enrol a and b');
  const origin = join(dir, 'origin.git');
  fixtureGit(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  fixtureGit(project, 'remote', 'add', 'origin', origin);
  fixtureGit(project, 'push', '-q', 'origin', 'main');
  const bare = join(dir, 'host', 'store.git');
  mkdirSync(bare, { recursive: true });
  const init = spawnSync('git', ['init', '-q', '--bare'], { cwd: bare, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return { dir, project, origin, bare, url: `file://${bare}` };
}

/** @param {...[string, { recipient: string }]} devices */
const devicesFile = (...devices) =>
  serializeDevices({
    schema_version: 1,
    devices: devices.map(([name, d]) => ({ name, recipient: d.recipient, added: '2026-11-15' })),
  });

/**
 * The owner changes the device list on origin's main, as their merge would; this checkout's
 * local main is left behind, so only a fetch sees it.
 * @param {ReturnType<typeof fixture>} f @param {string} text
 */
function mergeOnOrigin(f, text) {
  const other = join(f.dir, `owner-${Math.random().toString(36).slice(2)}`);
  fixtureGit(f.dir, 'clone', '-q', f.origin, other);
  fixtureGit(other, 'config', 'user.name', 'Owner');
  fixtureGit(other, 'config', 'user.email', 'owner@example.invalid');
  fixtureGit(other, 'config', 'commit.gpgsign', 'false');
  putFiles(other, { [DEVICES_PATH]: text });
  commitAll(other, 'devices');
  fixtureGit(other, 'push', '-q', 'origin', 'main');
}

/** @param {import('../lib/store/store.mjs').PrivateStore} store @param {string} id @param {number} n */
const question = (store, id, n) =>
  appendEvent(store, { event: 'asked', decision: `W-${n}`, id, at: at(n) });

/** @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} env */
async function hitld(argv, cwd, env) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, json: JSON.parse(out) };
}

/**
 * One device: its store, and the commands run as it.
 * @param {ReturnType<typeof fixture>} f @param {string} name @param {{ identity: string }} device
 */
function device(f, name, device) {
  const store = openStore(join(f.dir, 'stores', name));
  /** @param {string[]} argv @param {NodeJS.ProcessEnv} [env] */
  const run = (argv, env = {}) =>
    hitld(['store', ...argv, '--store', store.root], f.project, {
      HITLD_STORE_IDENTITY: device.identity,
      XDG_CONFIG_HOME: join(f.dir, 'config', name),
      ...env,
    });
  return { store, run, device };
}

/** Every object in a bare repository, inflated: [type, bytes]. @param {string} bare */
function objects(bare) {
  const r = spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], {
    cwd: bare,
    env: { PATH: process.env.PATH ?? '', GIT_DIR: bare },
    maxBuffer: 1 << 28,
  });
  assert.equal(r.status, 0, String(r.stderr));
  /** @type {Array<[string, Buffer]>} */
  const out = [];
  const buf = r.stdout;
  let at = 0;
  while (at < buf.length) {
    const nl = buf.indexOf(0x0a, at);
    const [, type, size] = buf.subarray(at, nl).toString('utf8').split(' ');
    const end = nl + 1 + Number(size);
    out.push([type, buf.subarray(nl + 1, end)]);
    at = end + 1;
  }
  return out;
}

/**
 * What a scan of the remote finds: every marker that appears in any object, its refs or its
 * configuration.
 * @param {string} bare @param {string[]} markers
 */
function scan(bare, markers) {
  const parts = objects(bare).map(([, b]) => b);
  parts.push(
    readFileSync(join(bare, 'config')),
    spawnSync('git', ['for-each-ref'], { cwd: bare, env: { GIT_DIR: bare } }).stdout,
  );
  const all = Buffer.concat(parts);
  return markers.filter((m) => all.includes(Buffer.from(m)));
}

/**
 * The paths a pushed version's bundle holds, opened with a device key.
 * @param {ReturnType<typeof fixture>} f @param {string} identity
 */
async function pushedPaths(f, identity) {
  const remote = createGitRemote({ url: f.url, dir: join(f.dir, 'reader') });
  const bytes = await remote.fetch(/** @type {string} */ (await remote.head()));
  const { bundle } = open(bytes, { identities: [identity] });
  const bundleFile = join(f.dir, 'reader.bundle');
  writeFileSync(bundleFile, bundle);
  const heads = spawnSync('git', ['bundle', 'list-heads', bundleFile], { encoding: 'utf8' });
  const commit = heads.stdout.split(' ')[0];
  const scratch = mkdtempSync(join(f.dir, 'reader-repo-'));
  const env = { PATH: process.env.PATH ?? '', GIT_DIR: join(scratch, '.git') };
  spawnSync('git', ['init', '-q'], { cwd: scratch, env });
  spawnSync('git', ['fetch', '-q', bundleFile, 'refs/heads/main:refs/heads/in'], {
    cwd: scratch,
    env,
  });
  const ls = spawnSync('git', ['ls-tree', '-r', '--name-only', commit], {
    cwd: scratch,
    env,
    encoding: 'utf8',
  });
  return ls.stdout.trim().split('\n').sort();
}

/** @param {import('../lib/store/store.mjs').PrivateStore} store */
function fill(store) {
  question(store, 'E-1', 1);
  question(store, 'E-2', 2);
  store.write('precedents/P-1.json', `{"id":"P-1","note":"${SECRET_NOTE}"}\n`);
  store.write('notes/cache.md', `${SECRET_NOTE}\n`);
  store.write('run-state.json', '{"only-on-this-machine":true}\n');
  store.write('run/checkpoints/slot-0.json', '{}\n');
  store.write('primary-checkout.json', '{"path":"/home/o/src/p"}\n');
  store.append('usage/snapshots.jsonl', '{"a":1}\n');
  store.write('index.sqlite', 'machine-local index');
}

test('remote set records the address outside the repository, remote show reads it back', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  const shown = await a.run(['remote', 'show']);
  assert.equal(shown.code, EXIT.ok, JSON.stringify(shown.json));
  assert.equal(shown.json.remote, null);

  const set = await a.run(['remote', 'set', f.url]);
  assert.equal(set.code, EXIT.ok, JSON.stringify(set.json));
  assert.equal(set.json.url, f.url);
  assert.equal((await a.run(['remote', 'show'])).json.remote.url, f.url);

  // The address is in the person file, outside the repository; no commit or bundle carries it,
  // and the project holds nothing new.
  assert.equal(set.json.written, 'person');
  assert.equal(existsSync(join(f.dir, 'config', 'a', 'human-in-the-lead', 'person.json')), true);
  fill(a.store);
  const commit = snapshot(a.store.root, 'test');
  const tracked = git(a.store.root, ['ls-tree', '-r', '--name-only', commit]).stdout.toString();
  assert.doesNotMatch(tracked, /hitld-remote|hitld-sync/);
  assert.deepEqual(
    spawnSync('git', ['status', '--porcelain'], { cwd: f.project, encoding: 'utf8' }).stdout,
    '',
  );

  // Unusable addresses are refused, and nothing is recorded.
  const b = device(f, 'b', DEVICE_B);
  for (const bad of ['http://host/x.git', 'https://u:pw@host/x.git', 'ext::sh -c x', '-oops']) {
    const r = await b.run(['remote', 'set', bad]);
    assert.equal(r.code, EXIT.failed, bad);
    assert.equal(r.json.error, 'remote-url-invalid', bad);
  }
  assert.equal((await b.run(['remote', 'show'])).json.remote, null);
});

test('push then pull on a second store; status before and after', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  const b = device(f, 'b', DEVICE_B);
  fill(a.store);

  // No remote set: push and pull say so, status reports it.
  for (const sub of ['push', 'pull']) {
    const r = await a.run([sub]);
    assert.equal(r.json.error, 'no-remote', sub);
  }
  const bare = await a.run(['status']);
  assert.equal(bare.code, EXIT.ok, JSON.stringify(bare.json));
  assert.deepEqual(
    [bare.json.remote, bare.json.push_due, bare.json.pull_due, bare.json.device.enrolled],
    [null, false, null, true],
  );

  await a.run(['remote', 'set', f.url]);
  await b.run(['remote', 'set', f.url]);

  // Before: a has text to push and the remote is empty.
  const before = await a.run(['status']);
  assert.equal(before.json.remote.url, f.url);
  assert.equal(before.json.remote_version, null);
  assert.equal(before.json.push_due, true);
  assert.equal(before.json.pull_due, false);
  assert.equal(before.json.synced, null);

  const pushed = await a.run(['push']);
  assert.equal(pushed.code, EXIT.ok, JSON.stringify(pushed.json));
  assert.equal(pushed.json.result, 'pushed');
  assert.equal(pushed.json.recipients, 2);
  assert.equal(pushed.json.head, head(a.store.root));

  // After: nothing due, and the version this store merged is recorded.
  const after = await a.run(['status']);
  assert.equal(after.json.push_due, false);
  assert.equal(after.json.pull_due, false);
  assert.equal(after.json.remote_version, pushed.json.version);
  assert.deepEqual(after.json.synced, { version: pushed.json.version, head: head(a.store.root) });
  assert.equal(after.json.local_changed, false);
  // Pushing again changes nothing.
  const again = await a.run(['push']);
  assert.equal(again.json.result, 'up-to-date');
  assert.equal(again.json.version, pushed.json.version);

  // b is behind: a pull is due until it pulls.
  const behind = await b.run(['status']);
  assert.equal(behind.json.pull_due, true);
  assert.equal(behind.json.push_due, false);
  assert.equal(behind.json.local_version, null);

  const pulled = await b.run(['pull']);
  assert.equal(pulled.code, EXIT.ok, JSON.stringify(pulled.json));
  assert.equal(pulled.json.result, 'fast-forward');
  assert.equal(pulled.json.remote_version, pushed.json.version);
  assert.equal(b.store.read('ledger.jsonl'), a.store.read('ledger.jsonl'));
  assert.equal(b.store.read('notes/cache.md'), `${SECRET_NOTE}\n`);
  assert.equal(pulled.json.index.events, 2);
  const caughtUp = await b.run(['status']);
  assert.equal(caughtUp.json.pull_due, false);
  assert.equal(caughtUp.json.push_due, false);
  assert.equal(caughtUp.json.synced.version, pushed.json.version);
  // A second pull has nothing to do.
  assert.equal((await b.run(['pull'])).json.result, 'up-to-date');

  // b writes; its push is due, and a pulls it.
  question(b.store, 'E-b1', 3);
  assert.equal((await b.run(['status'])).json.push_due, true);
  assert.equal((await b.run(['push'])).json.result, 'pushed');
  assert.equal((await a.run(['status'])).json.pull_due, true);
  assert.equal((await a.run(['pull'])).json.result, 'fast-forward');
  assert.equal(a.store.read('ledger.jsonl'), b.store.read('ledger.jsonl'));
});

test('the remote holds no plain text of the store (milestone c4)', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  fill(a.store);
  await a.run(['remote', 'set', f.url]);
  assert.equal((await a.run(['push'])).code, EXIT.ok);
  question(a.store, 'E-3', 3);
  assert.equal((await a.run(['push'])).code, EXIT.ok);

  const markers = [
    ...(a.store.read('ledger.jsonl') ?? '').trim().split('\n'),
    SECRET_NOTE,
    'tenant 4471',
    'precedents/P-1.json',
    'notes/cache.md',
    'ledger.jsonl',
    '"event":"asked"',
    'W-1',
    'E-3',
    'only-on-this-machine',
  ];
  // The scan sees every object: blobs, trees, commits, refs and the repository's configuration.
  assert.ok(objects(f.bare).length >= 6);
  assert.deepEqual(scan(f.bare, markers), []);

  // The scan finds plain text when there is some: the same fixture pushed unencrypted.
  const plain = join(f.dir, 'plain.git');
  mkdirSync(plain);
  const env = {
    PATH: process.env.PATH ?? '',
    GIT_DIR: plain,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  spawnSync('git', ['init', '-q', '--bare'], { cwd: plain, env });
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: plain,
    env,
    input: a.store.read('ledger.jsonl') ?? '',
    encoding: 'utf8',
  }).stdout.trim();
  spawnSync('git', ['update-ref', 'refs/heads/x', blob], { cwd: plain, env });
  assert.ok(scan(plain, markers).includes('"event":"asked"'));
});

test('machine-local files are never pushed', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  fill(a.store);
  await a.run(['remote', 'set', f.url]);
  const pushed = await a.run(['push']);
  assert.equal(pushed.code, EXIT.ok, JSON.stringify(pushed.json));
  // The bundle a device opens holds the text and nothing else.
  assert.deepEqual(await pushedPaths(f, DEVICE_B.identity), [
    '.gitignore',
    'ledger.jsonl',
    'notes/cache.md',
    'precedents/P-1.json',
  ]);
  // Nor does the address or what this machine last merged.
  assert.equal(existsSync(join(a.store.root, '.git', 'hitld-sync.json')), true);
  assert.equal(
    (await pushedPaths(f, DEVICE_A.identity)).some((p) => /hitld-|\.git\//.test(p)),
    false,
  );

  // On the other side they stay absent, and its own machine-local files stay its own.
  const b = device(f, 'b', DEVICE_B);
  b.store.write('run-state.json', '{"b":true}\n');
  await b.run(['remote', 'set', f.url]);
  assert.equal((await b.run(['pull'])).code, EXIT.ok);
  assert.equal(b.store.read('run-state.json'), '{"b":true}\n');
  assert.equal(b.store.read('primary-checkout.json'), null);
  assert.equal(b.store.read('usage/snapshots.jsonl'), null);
  assert.equal(b.store.read('run/checkpoints/slot-0.json'), null);
});

test('a push against a moved remote pulls, merges and pushes again; both records survive', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  const b = device(f, 'b', DEVICE_B);
  question(a.store, 'E-1', 1);
  await a.run(['remote', 'set', f.url]);
  await b.run(['remote', 'set', f.url]);
  const v1 = await a.run(['push']);
  assert.equal(v1.json.result, 'pushed');
  assert.equal((await b.run(['pull'])).code, EXIT.ok);

  // Both write on top of the same version; a pushes first.
  question(a.store, 'E-a1', 2);
  question(b.store, 'E-b1', 3);
  b.store.write('notes/b.md', 'written on b\n');
  const first = await a.run(['push']);
  assert.equal(first.json.result, 'pushed');
  const second = await b.run(['push']);
  assert.equal(second.code, EXIT.ok, JSON.stringify(second.json));
  assert.equal(second.json.result, 'pushed');
  assert.equal(second.json.merged.length, 1);
  assert.equal(second.json.merged[0].version, first.json.version);
  assert.equal(second.json.previous_version, v1.json.version);

  for (const id of ['E-1', 'E-a1', 'E-b1']) {
    assert.match(b.store.read('ledger.jsonl') ?? '', new RegExp(`"id":"${id}"`));
  }
  // a takes b's push and ends with the same history.
  assert.equal((await a.run(['pull'])).code, EXIT.ok);
  for (const id of ['E-1', 'E-a1', 'E-b1']) {
    assert.match(a.store.read('ledger.jsonl') ?? '', new RegExp(`"id":"${id}"`));
  }
  assert.equal(a.store.read('ledger.jsonl'), b.store.read('ledger.jsonl'));
  assert.equal(a.store.read('notes/b.md'), 'written on b\n');
  assert.equal((await a.run(['status'])).json.push_due, false);
});

test('two devices pushing at once both land', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  const b = device(f, 'b', DEVICE_B);
  question(a.store, 'E-1', 1);
  await a.run(['remote', 'set', f.url]);
  await b.run(['remote', 'set', f.url]);
  await a.run(['push']);
  await b.run(['pull']);
  question(a.store, 'E-a1', 2);
  question(b.store, 'E-b1', 3);
  const [ra, rb] = await Promise.all([a.run(['push']), b.run(['push'])]);
  assert.equal(ra.code, EXIT.ok, JSON.stringify(ra.json));
  assert.equal(rb.code, EXIT.ok, JSON.stringify(rb.json));
  await a.run(['pull']);
  await b.run(['pull']);
  for (const side of [a, b]) {
    for (const id of ['E-1', 'E-a1', 'E-b1']) {
      assert.match(side.store.read('ledger.jsonl') ?? '', new RegExp(`"id":"${id}"`));
    }
  }
  assert.equal(a.store.read('ledger.jsonl'), b.store.read('ledger.jsonl'));
});

test('a real conflict stops the push and changes nothing on either side', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  const b = device(f, 'b', DEVICE_B);
  a.store.write('precedents/P-1.json', '{"id":"P-1","v":1}\n');
  await a.run(['remote', 'set', f.url]);
  await b.run(['remote', 'set', f.url]);
  const firstVersion = (await a.run(['push'])).json.version;
  await b.run(['pull']);
  a.store.write('precedents/P-1.json', '{"id":"P-1","v":2}\n');
  b.store.write('precedents/P-1.json', '{"id":"P-1","v":3}\n');
  const landed = await a.run(['push']);
  assert.equal(landed.json.result, 'pushed');
  const stopped = await b.run(['push']);
  assert.equal(stopped.code, EXIT.failed);
  assert.equal(stopped.json.error, 'conflict');
  assert.deepEqual(
    stopped.json.conflicts.map((/** @type {{ path: string }} */ c) => c.path),
    ['precedents/P-1.json'],
  );
  assert.equal(b.store.read('precedents/P-1.json'), '{"id":"P-1","v":3}\n');
  // What b last merged is still the version before a's push.
  assert.equal((await b.run(['status'])).json.synced.version, firstVersion);
  const remote = createGitRemote({ url: f.url, dir: remoteDir(b.store.root) });
  assert.equal(await remote.head(), landed.json.version);
  // Pull stops the same way, with the local copy untouched.
  const pull = await b.run(['pull']);
  assert.equal(pull.json.error, 'conflict');
  assert.equal(b.store.read('precedents/P-1.json'), '{"id":"P-1","v":3}\n');
});

test('pull with the wrong identity, no identity or a malformed one is refused', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  fill(a.store);
  await a.run(['remote', 'set', f.url]);
  assert.equal((await a.run(['push'])).code, EXIT.ok);

  const stranger = device(f, 'stranger', STRANGER);
  await stranger.run(['remote', 'set', f.url]);
  const wrong = await stranger.run(['pull']);
  assert.equal(wrong.code, EXIT.failed);
  assert.equal(wrong.json.error, 'age-no-match');
  assert.doesNotMatch(JSON.stringify(wrong.json), new RegExp(STRANGER.identity));
  assert.deepEqual(stranger.store.list(), []);
  assert.equal((await stranger.run(['status'])).json.synced, null);

  const none = await stranger.run(['pull'], { HITLD_STORE_IDENTITY: '' });
  assert.equal(none.json.error, 'no-identity');
  assert.match(none.json.message, /HITLD_STORE_IDENTITY/);
  const malformed = await stranger.run(['pull'], {
    HITLD_STORE_IDENTITY: 'AGE-SECRET-KEY-1NOTAKEY',
  });
  assert.equal(malformed.json.error, 'age-bad-identity');
  assert.doesNotMatch(malformed.json.message, /NOTAKEY/);
  assert.deepEqual(stranger.store.list(), []);
});

test('the identity may come from a file descriptor; neither secret is ever an argument', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  fill(a.store);
  await a.run(['remote', 'set', f.url]);
  assert.equal((await a.run(['push'])).code, EXIT.ok);

  const b = device(f, 'b', { identity: '' });
  await b.run(['remote', 'set', f.url]);
  const secret = join(f.dir, 'identity.txt');
  writeFileSync(secret, `# public key: ${DEVICE_B.recipient}\n${DEVICE_B.identity}\n`);
  const fd = openSync(secret, 'r');
  try {
    const r = await b.run(['pull', '--identity-fd', String(fd)], { HITLD_STORE_IDENTITY: '' });
    assert.equal(r.code, EXIT.ok, JSON.stringify(r.json));
    assert.doesNotMatch(JSON.stringify(r.json), new RegExp(DEVICE_B.identity));
  } finally {
    closeSync(fd);
  }
  assert.equal(b.store.read('ledger.jsonl'), a.store.read('ledger.jsonl'));

  for (const sub of ['push', 'pull', 'status']) {
    for (const secretFlag of ['--passphrase', '--identity']) {
      const r = await hitld(['store', sub, secretFlag, 'x'], f.project, {});
      assert.equal(r.code, EXIT.usage, `${sub} ${secretFlag}`);
    }
  }
});

test('every command is refused to executors', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  fill(a.store);
  const subs = [
    ['push'],
    ['pull'],
    ['status'],
    ['remote', 'set', f.url],
    ['remote', 'set', f.url, '--machine'],
    ['remote', 'clear'],
    ['remote', 'show'],
  ];
  for (const sub of subs) {
    for (const env of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-3' }]) {
      const r = await a.run(sub, env);
      assert.equal(r.code, EXIT.failed, sub.join(' '));
      assert.equal(r.json.error, 'not-permitted', sub.join(' '));
    }
  }
  // Refused before anything was recorded.
  assert.equal(existsSync(join(a.store.root, '.git', 'hitld-remote.json')), false);
});

test("a push needs a device on main's list, and some text", async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  await a.run(['remote', 'set', f.url]);
  const remote = createGitRemote({ url: f.url, dir: remoteDir(a.store.root) });
  const base = { root: a.store.root, projectId: 'fixture', remote, url: f.url };
  const devices = resolveDevices({
    root: f.project,
    store: a.store.root,
    env: { HITLD_STORE_IDENTITY: DEVICE_A.identity },
  });
  assert.deepEqual(devices.recipients.sort(), [DEVICE_A.recipient, DEVICE_B.recipient].sort());
  assert.equal(devices.identity, DEVICE_A.identity);
  assert.equal(devices.enrolled, true);
  assert.equal(devices.device, 'device-a');

  await assert.rejects(pushStore({ ...base, devices }), { code: 'nothing-to-push' });
  question(a.store, 'E-1', 1);
  await assert.rejects(pushStore({ ...base, devices: { ...devices, enrolled: false } }), {
    code: 'device-not-enrolled',
  });
  assert.equal(await remote.head(), null, 'nothing was pushed');
  const pushed = await pushStore({ ...base, devices });
  assert.equal(pushed.result, 'pushed');
  assert.equal(pushed.device, 'device-a');

  // Status reports the enrolment the resolver gave.
  const status = await storeStatus({
    root: base.root,
    projectId: 'fixture',
    opened: { remote, url: f.url, source: 'machine' },
    devices: { ...devices, enrolled: false, device: 'laptop' },
  });
  assert.deepEqual(status.device, {
    name: 'laptop',
    enrolled: false,
    has_identity: true,
    recipients: 2,
  });
});

test('push takes no recipient flag: it is encrypted to the keys on main and nothing else', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  fill(a.store);
  await a.run(['remote', 'set', f.url]);
  const extra = await a.run(['push', '--recipient', STRANGER.recipient]);
  assert.equal(extra.code, EXIT.usage);
  assert.equal(extra.json.error, 'usage');
  const remote = createGitRemote({ url: f.url, dir: join(f.dir, 'reader') });
  assert.equal(await remote.head(), null, 'nothing was pushed');

  const pushed = await a.run(['push']);
  assert.equal(pushed.code, EXIT.ok, JSON.stringify(pushed.json));
  assert.equal(pushed.json.recipients, 2);
  const bytes = await remote.fetch(/** @type {string} */ (await remote.head()));
  assert.throws(() => open(bytes, { identities: [STRANGER.identity] }), { code: 'age-no-match' });
  for (const d of [DEVICE_A, DEVICE_B]) open(bytes, { identities: [d.identity] });
});

test("a device not on main's list is refused by name, and nothing is pushed", async () => {
  const f = fixture();
  const s = device(f, 's', STRANGER);
  fill(s.store);
  await s.run(['remote', 'set', f.url]);
  const r = await s.run(['push']);
  assert.equal(r.code, EXIT.failed);
  assert.equal(r.json.error, 'device-not-enrolled');
  assert.match(r.json.message, new RegExp(STRANGER.recipient));
  // Enrolled in the working tree only: still refused.
  putFiles(f.project, {
    [DEVICES_PATH]: devicesFile(['device-a', DEVICE_A], ['s', STRANGER]),
  });
  assert.equal((await s.run(['push'])).json.error, 'device-not-enrolled');
  const remote = createGitRemote({ url: f.url, dir: join(f.dir, 'reader') });
  assert.equal(await remote.head(), null);
});

test('c3 through store push: a device removed on main opens nothing pushed after, and nothing older is left', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  const b = device(f, 'b', DEVICE_B);
  fill(a.store);
  await a.run(['remote', 'set', f.url]);
  await b.run(['remote', 'set', f.url]);
  const first = await a.run(['push']);
  assert.equal(first.code, EXIT.ok, JSON.stringify(first.json));
  assert.deepEqual(first.json.rotation, { rotated: [], removed: [] });
  assert.equal((await b.run(['pull'])).code, EXIT.ok, 'b reads it while enrolled');

  // The owner removes b on origin's main; this checkout's local main has not moved. The push
  // fetches main first, so it sees the removal anyway.
  mergeOnOrigin(f, devicesFile(['device-a', DEVICE_A]));
  // Nothing new in the store, and still the push replaces the head the removed key opens.
  const second = await a.run(['push']);
  assert.equal(second.code, EXIT.ok, JSON.stringify(second.json));
  assert.equal(second.json.result, 'pushed');
  assert.equal(second.json.recipients, 1);
  assert.deepEqual(second.json.rotation, {
    rotated: ['device-b'],
    removed: [first.json.version],
  });
  assert.deepEqual(
    readRotations(a.store).map((x) => [x.event, x.name]),
    [['rotated', 'device-b']],
  );

  // What the remote holds: one file, which the removed key does not open.
  const remote = createGitRemote({ url: f.url, dir: join(f.dir, 'reader') });
  assert.equal(await remote.head(), second.json.version);
  await assert.rejects(remote.fetch(first.json.version), { code: 'remote-version-missing' });
  const tree = spawnSync('git', ['ls-tree', '-r', '--name-only', 'hitld-store'], {
    cwd: f.bare,
    env: { PATH: process.env.PATH ?? '', GIT_DIR: f.bare },
    encoding: 'utf8',
  });
  assert.deepEqual(tree.stdout.trim().split('\n'), [`bundles/${second.json.version}.bundle`]);
  const bytes = await remote.fetch(second.json.version);
  assert.throws(() => open(bytes, { identities: [DEVICE_B.identity] }), { code: 'age-no-match' });
  question(b.store, 'E-9', 9);
  const pulled = await b.run(['pull']);
  assert.equal(pulled.json.error, 'age-no-match');
  // b may not push either.
  assert.equal((await b.run(['push'])).json.error, 'device-not-enrolled');

  // The rotation is done once. The next push carries its record (store text) and prunes nothing;
  // the one after, with nothing new, is up to date.
  const third = await a.run(['push']);
  assert.equal(third.json.result, 'pushed');
  assert.deepEqual(third.json.rotation, { rotated: [], removed: [] });
  assert.equal((await a.run(['push'])).json.result, 'up-to-date');
});

test('a push refuses when main cannot be fetched, rather than use a stale device list', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  fill(a.store);
  await a.run(['remote', 'set', f.url]);
  fixtureGit(f.project, 'remote', 'set-url', 'origin', join(f.dir, 'gone.git'));
  const r = await a.run(['push']);
  assert.equal(r.code, EXIT.failed);
  assert.equal(r.json.error, 'devices-fetch-failed');
  const remote = createGitRemote({ url: f.url, dir: join(f.dir, 'reader') });
  assert.equal(await remote.head(), null);

  // A checkout with no origin has nothing to fetch: its local main is the list.
  fixtureGit(f.project, 'remote', 'remove', 'origin');
  assert.equal((await a.run(['push'])).json.result, 'pushed');
});

test('status reports an unreachable remote instead of failing, and pull of an empty remote is a no-op', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  question(a.store, 'E-1', 1);
  await a.run(['remote', 'set', f.url]);
  const empty = await a.run(['pull']);
  assert.deepEqual(
    [empty.json.ok, empty.json.result, empty.json.remote_version],
    [true, 'empty', null],
  );

  await a.run(['remote', 'set', `file://${join(f.dir, 'missing.git')}`]);
  const listed = [a.store.list(), head(a.store.root)];
  const down = await a.run(['status']);
  assert.equal(down.code, EXIT.ok, JSON.stringify(down.json));
  assert.equal(down.json.remote_error.code, 'remote-unreachable');
  assert.equal(down.json.pull_due, null);
  assert.equal(down.json.push_due, true);
  // Status changed nothing in the store.
  assert.deepEqual([a.store.list(), head(a.store.root)], listed);
  assert.equal((await a.run(['push'])).json.error, 'remote-unreachable');
});

test('the address comes from HITLD_STORE_REMOTE alone, with nothing set on this machine', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  fill(a.store);
  const env = { HITLD_STORE_REMOTE: f.url };

  const shown = await a.run(['remote', 'show'], env);
  assert.deepEqual(shown.json.remote, { url: f.url, source: 'environment' });
  assert.deepEqual(
    [shown.json.environment_url, shown.json.person_url, shown.json.override_url],
    [f.url, null, null],
  );
  const before = await a.run(['status'], env);
  assert.deepEqual(before.json.remote, { url: f.url, source: 'environment' });
  assert.equal(before.json.push_due, true);

  const pushed = await a.run(['push'], env);
  assert.equal(pushed.code, EXIT.ok, JSON.stringify(pushed.json));
  assert.equal(pushed.json.result, 'pushed');
  assert.equal(existsSync(join(a.store.root, '.git', 'hitld-remote.json')), false);
  assert.equal(existsSync(join(f.dir, 'config', 'a', 'human-in-the-lead', 'person.json')), false);

  // A new container: an empty store, the checkout, this device's key and the variable.
  const fresh = device(f, 'fresh', DEVICE_B);
  const pulled = await fresh.run(['pull'], env);
  assert.equal(pulled.code, EXIT.ok, JSON.stringify(pulled.json));
  assert.equal(pulled.json.result, 'fast-forward');
  assert.equal(fresh.store.read('notes/cache.md'), `${SECRET_NOTE}\n`);

  // An unusable address in the variable is refused like any other.
  const bad = await a.run(['push'], { HITLD_STORE_REMOTE: 'https://u:pw@host/x.git' });
  assert.equal(bad.json.error, 'remote-url-invalid');
});

test('remote set writes the person file by default, never policy.json; --machine writes the override', async () => {
  const f = fixture();
  const a = device(f, 'a', DEVICE_A);
  const policyFile = join(f.project, '.human-in-the-lead', 'policy.json');
  const original = readFileSync(policyFile, 'utf8');

  const set = await a.run(['remote', 'set', f.url]);
  assert.equal(set.code, EXIT.ok, JSON.stringify(set.json));
  assert.equal(set.json.written, 'person');
  assert.equal(set.json.url, f.url);
  assert.equal(set.json.project, 'fixture');
  assert.equal(readFileSync(policyFile, 'utf8'), original, 'policy.json is never written');
  const person = JSON.parse(readFileSync(set.json.path, 'utf8'));
  assert.deepEqual(person.projects, { fixture: { store_remote: f.url } });
  assert.equal(person.schema_version, 3);
  assert.deepEqual((await a.run(['remote', 'show'])).json.remote, {
    url: f.url,
    source: 'person',
  });

  // The override is used only when neither the variable nor the person file gives an address.
  const mirror = otherHost(f, 'mirror.git');
  const machine = await a.run(['remote', 'set', mirror.url, '--machine']);
  assert.equal(machine.json.written, 'machine');
  assert.match(machine.json.message, /the person file comes first here/);
  const shown = await a.run(['remote', 'show']);
  assert.deepEqual(shown.json.remote, { url: f.url, source: 'person' });
  assert.deepEqual([shown.json.person_url, shown.json.override_url], [f.url, mirror.url]);
  // The variable comes before both.
  const env = { HITLD_STORE_REMOTE: mirror.url };
  assert.deepEqual((await a.run(['remote', 'show'], env)).json.remote, {
    url: mirror.url,
    source: 'environment',
  });

  // Taking it out of the person file leaves the override.
  const cleared = await a.run(['remote', 'clear']);
  assert.deepEqual([cleared.json.removed, cleared.json.from], [f.url, 'person']);
  assert.deepEqual(cleared.json.remote, { url: mirror.url, source: 'machine' });
  assert.equal(JSON.parse(readFileSync(set.json.path, 'utf8')).projects, undefined);
  const gone = await a.run(['remote', 'clear', '--machine']);
  assert.deepEqual([gone.json.removed, gone.json.remote], [mirror.url, null]);

  // An unusable address is refused in both places, and nothing is written.
  for (const extra of [[], ['--machine']]) {
    const bad = await a.run(['remote', 'set', 'https://u:pw@host/x.git', ...extra]);
    assert.equal(bad.json.error, 'remote-url-invalid');
  }
  assert.equal((await a.run(['remote', 'show'])).json.remote, null);
});

test('back on another address, what was merged from the first does not count: the push is due', async () => {
  const f = fixture();
  const mirror = otherHost(f, 'mirror.git');
  const a = device(f, 'a', DEVICE_A);
  fill(a.store);
  await a.run(['remote', 'set', f.url]);
  assert.equal((await a.run(['push'], { HITLD_STORE_REMOTE: mirror.url })).json.result, 'pushed');
  assert.equal(await createGitRemote({ url: f.url, dir: join(f.dir, 'r1') }).head(), null);
  const back = await a.run(['status']);
  assert.deepEqual(back.json.remote, { url: f.url, source: 'person' });
  assert.equal(back.json.synced, null);
  assert.equal(back.json.push_due, true);
  assert.equal((await a.run(['push'])).json.result, 'pushed');
  assert.notEqual(await createGitRemote({ url: f.url, dir: join(f.dir, 'r2') }).head(), null);
});

test('policy.json refuses store.remote.url, any address, and says where it goes', async () => {
  for (const url of [
    'https://github.com/example-owner/sample-app-store.git',
    'http://host/x.git',
    null,
  ]) {
    const { policy, errors } = resolvePolicy({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
      store: { remote: { url } },
    });
    assert.equal(policy, null, String(url));
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.equal(errors[0].path, 'store.remote.url');
    assert.match(errors[0].message, /HITLD_STORE_REMOTE/);
    assert.match(errors[0].message, /hitld store remote set/);
  }
  const required = resolvePolicy({
    schema_version: 1,
    project: { id: 'fixture', key: 'W' },
    store: { remote: { required: true } },
  });
  assert.deepEqual(required.errors, []);
  assert.equal(required.policy?.store?.remote?.required, true);
  assert.equal(
    resolvePolicy({ schema_version: 1, project: { id: 'fixture', key: 'W' } }).policy?.store?.remote
      ?.required,
    false,
  );

  // hitld check policy says the same about a committed address.
  const f = fixture();
  setPolicyUrl(f, 'https://github.com/example-owner/sample-app-store.git');
  const checked = await hitld(['check', 'policy'], f.project, {});
  assert.equal(checked.json.ok, false);
  assert.equal(checked.json.errors[0].path, 'store.remote.url');
  assert.match(checked.json.errors[0].message, /person file/);
});
