import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, EXIT } from '../lib/cli/main.mjs';
import { openStore } from '../lib/store/store.mjs';
import { appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { exportStore, importStore, syncStore } from '../lib/store/sync.mjs';
import { formatOf, open, seal } from '../lib/store/sealed.mjs';
import { generateIdentity, parseHeader } from '../lib/store/age.mjs';
import { git, head, isMachineLocal, mergeAppendOnly, snapshot } from '../lib/store/git.mjs';
import { INDEX_FILE, readIndex, rebuildIndex } from '../lib/store/index-db.mjs';
import { sealFormat1 } from './helpers/format1.mjs';

const BIN = fileURLToPath(new URL('../bin/hitld.mjs', import.meta.url));
/** A format-1 file the shipped format-1 writer made: project "fixture", one ledger event. */
const FORMAT_1_FIXTURE = fileURLToPath(new URL('./fixtures/store/format-1.hitld', import.meta.url));
/** Cheaper than the default cost, inside the bounds a file may name. */
const scrypt = { N: 2 ** 14, r: 8, p: 1 };
const PASS = 'a long passphrase for tests';
/** Two devices' key pairs, and one that is not enrolled. */
const DEVICE = generateIdentity();
const OTHER_DEVICE = generateIdentity();
const STRANGER = generateIdentity();
const at = (/** @type {number} */ n) => `2026-11-14T10:${String(n).padStart(2, '0')}:00.000Z`;

/** A project directory with a policy.json, and a scratch area for stores and files. */
function fixture(projectId = 'fixture') {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-store-sync-'));
  const project = join(dir, 'project');
  mkdirSync(join(project, '.human-in-the-lead'), { recursive: true });
  mkdirSync(join(project, '.git'));
  writeFileSync(
    join(project, '.human-in-the-lead', 'policy.json'),
    JSON.stringify({ schema_version: 1, project: { id: projectId, key: 'W' } }),
  );
  return { dir, project, file: join(dir, 'store.hitld') };
}

/** @param {import('../lib/store/store.mjs').PrivateStore} store @param {string} id @param {number} n */
const question = (store, id, n) =>
  appendEvent(store, { event: 'asked', decision: `W-${n}`, id, at: at(n) });

/** @param {string} root @param {string} file @param {string} [projectId] */
const opts = (root, file, projectId = 'fixture') => ({
  root,
  file,
  projectId,
  recipients: [DEVICE.recipient, OTHER_DEVICE.recipient],
  identities: [DEVICE.identity],
});

/** The schema versions this release writes. */
function versions() {
  const registry = schemas();
  return /** @type {Record<string, number>} */ (
    Object.fromEntries(registry.versionedIds().map((id) => [id, registry.currentVersion(id)]))
  );
}

test('round trip: the text history moves to another store; machine-local files and the index stay', async () => {
  const { dir, file } = fixture();
  const a = openStore(join(dir, 'stores', 'a'));
  question(a, 'E-1', 1);
  question(a, 'E-2', 2);
  a.write('precedents/P-1.json', '{"id":"P-1"}\n');
  a.write('run-state.json', '{"secret-to-this-machine":true}\n');
  a.write('run/checkpoints/slot-0.json', '{}\n');
  a.write('primary-checkout.json', '{"path":"/home/o/src/p"}\n');
  a.append('usage/snapshots.jsonl', '{"a":1}\n');
  mkdirSync(join(dir, 'stores', '_machine'), { recursive: true });
  writeFileSync(join(dir, 'stores', '_machine', 'registry.sqlite'), 'machine');
  await rebuildIndex(a);

  const out = exportStore(opts(a.root, file));
  assert.equal(out.head, head(a.root));
  assert.equal(out.format, 2);
  assert.equal(out.recipients, 2);
  const bytes = readFileSync(file);
  assert.ok(!bytes.includes(Buffer.from('W-1')), 'the file is encrypted');
  assert.ok(!bytes.includes(Buffer.from('P-1')), 'the file is encrypted');
  // An age file with one X25519 stanza per recipient.
  assert.equal(formatOf(bytes), 2);
  assert.deepEqual(
    parseHeader(bytes).stanzas.map((s) => s.type),
    ['X25519', 'X25519'],
  );

  // What the bundle holds: the text, no machine-local file, no index.
  const committed = git(a.root, ['ls-tree', '-r', '--name-only', out.head])
    .stdout.toString('utf8')
    .trim()
    .split('\n');
  assert.deepEqual(committed.sort(), ['.gitignore', 'ledger.jsonl', 'precedents/P-1.json']);

  // The other device opens it with its own key.
  const b = openStore(join(dir, 'stores', 'b'));
  const r = await importStore({ ...opts(b.root, file), identities: [OTHER_DEVICE.identity] });
  assert.equal(r.ok, true);
  assert.equal(r.format, 2);
  assert.equal(r.result, 'fast-forward');
  assert.equal(r.head, out.head);
  assert.equal(b.read('ledger.jsonl'), a.read('ledger.jsonl'));
  assert.equal(b.read('precedents/P-1.json'), '{"id":"P-1"}\n');
  for (const local of ['run-state.json', 'run/checkpoints/slot-0.json', 'primary-checkout.json']) {
    assert.equal(b.read(local), null, local);
  }
  assert.equal(b.read('usage/snapshots.jsonl'), null);
  // The index was rebuilt from the text on this side.
  assert.deepEqual(await readIndex(b), { events: 2, index_version: 1 });
  assert.deepEqual(b.list(), ['index.sqlite', 'ledger.jsonl', 'precedents/P-1.json']);
});

test('both machines write, then sync both ways: each ends with the same history', async () => {
  const { dir, file } = fixture();
  const a = openStore(join(dir, 'a'));
  const b = openStore(join(dir, 'b'));
  const asB = (/** @type {string} */ root) => ({
    ...opts(root, file),
    identities: [OTHER_DEVICE.identity],
  });
  question(a, 'E-1', 1);
  await syncStore(opts(a.root, file)); // a writes the file
  await syncStore(asB(b.root)); // b takes it and writes back
  assert.equal(b.read('ledger.jsonl'), a.read('ledger.jsonl'));

  // Distinct event IDs on each side (as reserved ID blocks would give), plus a file only one side changed.
  question(a, 'E-a1', 3);
  question(b, 'E-b1', 2);
  b.append('trust/events.jsonl', '{"area":"cache","at":"2026-11-14T10:05:00Z"}\n');
  const toA = await syncStore(asB(b.root));
  assert.equal(toA.ok, true);
  const back = await syncStore(opts(a.root, file));
  assert.equal(back.ok, true);
  assert.equal(back.imported?.ok && back.imported.result, 'merged');
  const toB = await syncStore(asB(b.root));
  assert.equal(toB.ok, true);
  assert.equal(a.read('ledger.jsonl'), b.read('ledger.jsonl'));
  assert.deepEqual(
    readLedger(a).events.map((e) => e.id),
    ['E-1', 'E-b1', 'E-a1'],
  );
  assert.equal(readLedger(a).problems.length, 0);
  assert.equal(a.read('trust/events.jsonl'), b.read('trust/events.jsonl'));
  assert.deepEqual(await readIndex(b), { events: 3, index_version: 1 });
});

test('a key the file was not encrypted to is refused, and nothing changes', async () => {
  const { dir, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  exportStore(opts(a.root, file));
  const b = join(dir, 'b');
  await assert.rejects(
    importStore({ ...opts(b, file), identities: [STRANGER.identity] }),
    (/** @type {any} */ e) => e.code === 'age-no-match' && /not encrypted to/.test(e.message),
  );
  await assert.rejects(importStore({ ...opts(b, file), identities: [] }), {
    code: 'no-identity',
  });
  // A passphrase does not open format 2.
  await assert.rejects(importStore({ ...opts(b, file), identities: undefined, passphrase: PASS }), {
    code: 'no-identity',
  });
  assert.equal(existsSync(join(b, 'ledger.jsonl')), false);
  // Exporting needs at least one valid recipient.
  for (const recipients of [[], ['age1notakey'], [DEVICE.identity]]) {
    assert.throws(
      () => exportStore({ ...opts(a.root, join(dir, 'x.hitld')), recipients }),
      (/** @type {any} */ e) => ['no-recipients', 'age-bad-recipient'].includes(e.code),
    );
  }
  assert.equal(existsSync(join(dir, 'x.hitld')), false);
});

test('a file with one changed byte is refused, wherever the byte is', async () => {
  const { dir, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  exportStore(opts(a.root, file));
  const good = readFileSync(file);
  const payloadAt = parseHeader(good).payloadAt;
  /** @param {number} i @param {number} [to] */
  const change = (i, to) => {
    const bad = Buffer.from(good);
    bad[i] = to ?? bad[i] ^ 0x01;
    return bad;
  };
  const share = good.indexOf('-> X25519 ') + 12;
  for (const [where, bad, code] of /** @type {[string, Buffer, string][]} */ ([
    ['version line', change(20), 'age-header-invalid'],
    ['stanza share', change(share, good[share] === 0x41 ? 0x42 : 0x41), 'age-no-match'],
    [
      'header MAC',
      change(payloadAt - 4, good[payloadAt - 4] === 0x41 ? 0x42 : 0x41),
      'age-mac-mismatch',
    ],
    ['payload nonce', change(payloadAt + 1), 'age-payload-invalid'],
    ['payload body', change(payloadAt + 40), 'age-payload-invalid'],
    ['payload tag', change(good.length - 1), 'age-payload-invalid'],
    ['truncated', good.subarray(0, good.length - 1), 'age-payload-invalid'],
    ['extended', Buffer.concat([good, Buffer.from('x')]), 'age-payload-invalid'],
  ])) {
    const tampered = join(dir, `tampered-${where}.hitld`);
    writeFileSync(tampered, bad);
    await assert.rejects(
      importStore(opts(join(dir, `b-${where}`), tampered)),
      (/** @type {any} */ e) => e.code === code,
      where,
    );
    assert.equal(existsSync(join(dir, `b-${where}`, 'ledger.jsonl')), false, where);
  }
  // The untouched file still opens.
  assert.equal(open(good, { identities: [DEVICE.identity] }).manifest.project, 'fixture');
});

test('format 1: a file an earlier version wrote still imports with its passphrase', async () => {
  const { dir } = fixture();
  const b = join(dir, 'b');
  // Without the passphrase, or with the wrong one, it is refused.
  await assert.rejects(importStore({ ...opts(b, FORMAT_1_FIXTURE), identities: undefined }), {
    code: 'no-passphrase',
  });
  await assert.rejects(
    importStore({ ...opts(b, FORMAT_1_FIXTURE), passphrase: 'not the passphrase' }),
    (/** @type {any} */ e) => e.code === 'cannot-open' && /passphrase is wrong/.test(e.message),
  );
  assert.equal(existsSync(join(b, 'ledger.jsonl')), false);
  const r = await importStore({ ...opts(b, FORMAT_1_FIXTURE), passphrase: PASS });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.format, 1);
  assert.equal(r.result, 'fast-forward');
  assert.deepEqual(
    readLedger(openStore(b)).events.map((e) => e.id),
    ['E-1'],
  );
  assert.equal(openStore(b).read('precedents/P-1.json'), '{"id":"P-1"}\n');
});

test('format 1: one changed byte refuses the file, wherever the byte is', async () => {
  const { dir } = fixture();
  const good = readFileSync(FORMAT_1_FIXTURE);
  const headerEnd = good.indexOf(0x0a);
  const saltAt = good.indexOf(Buffer.from('"salt":"')) + 8;
  for (const [where, i] of /** @type {[string, number][]} */ ([
    ['header', saltAt],
    ['body', headerEnd + 10],
    ['tag', good.length - 1],
  ])) {
    const bad = Buffer.from(good);
    bad[i] ^= 0x01;
    const tampered = join(dir, `tampered-${where}.hitld`);
    writeFileSync(tampered, bad);
    await assert.rejects(
      importStore({ ...opts(join(dir, `b-${where}`), tampered), passphrase: PASS }),
      (/** @type {any} */ e) => ['cannot-open', 'bad-header'].includes(e.code),
      where,
    );
  }
  assert.equal(open(good, { passphrase: PASS }).manifest.project, 'fixture');
});

test('sync over a format-1 file imports it with the passphrase and writes format 2 back', async () => {
  const { dir, file } = fixture();
  copyFileSync(FORMAT_1_FIXTURE, file);
  const b = openStore(join(dir, 'b'));
  question(b, 'E-2', 2);
  const r = await syncStore({ ...opts(b.root, file), identities: undefined, passphrase: PASS });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.imported?.ok && r.imported.format, 1);
  assert.equal(r.exported?.format, 2);
  const after = readFileSync(file);
  assert.equal(formatOf(after), 2);
  // Now the device key opens it, and the passphrase does not.
  assert.deepEqual(
    readLedger(openStore(b.root)).events.map((e) => e.id),
    ['E-1', 'E-2'],
  );
  assert.equal(open(after, { identities: [OTHER_DEVICE.identity] }).manifest.head, head(b.root));
  assert.throws(() => open(after, { passphrase: PASS }), { code: 'no-identity' });
});

test("another project's file is refused", async () => {
  const { dir, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  exportStore(opts(a.root, file, 'other-project'));
  await assert.rejects(
    importStore(opts(join(dir, 'b'), file, 'fixture')),
    (/** @type {any} */ e) => e.code === 'another-project' && /other-project/.test(e.message),
  );
  assert.equal(existsSync(join(dir, 'b', 'ledger.jsonl')), false);
});

test('a newer schema, an unknown export format, or a costly format-1 header is refused', async () => {
  const { dir, file } = fixture();
  const known = versions();
  const manifest = {
    project: 'fixture',
    schema_versions: { ...known, 'ledger-entry': (known['ledger-entry'] ?? 1) + 1 },
    head: '0'.repeat(40),
    branch: 'main',
    created_at: at(1),
    hitld_version: '9.0.0',
  };
  writeFileSync(file, seal(manifest, Buffer.from('bundle'), [DEVICE.recipient]));
  await assert.rejects(
    importStore(opts(join(dir, 'b'), file)),
    (/** @type {any} */ e) => e.code === 'newer-schema' && /ledger-entry/.test(e.message),
  );
  // The same check holds for format 1.
  writeFileSync(file, sealFormat1(manifest, Buffer.from('bundle'), PASS, scrypt));
  await assert.rejects(
    importStore({ ...opts(join(dir, 'b'), file), passphrase: PASS }),
    (/** @type {any} */ e) => e.code === 'newer-schema',
  );

  const sealed = sealFormat1(
    { ...manifest, schema_versions: known },
    Buffer.from('x'),
    PASS,
    scrypt,
  );
  const future = Buffer.from(
    sealed.toString('latin1').replace('"format":1', '"format":3'),
    'latin1',
  );
  writeFileSync(file, future);
  await assert.rejects(
    importStore({ ...opts(join(dir, 'b'), file), passphrase: PASS }),
    (/** @type {any} */ e) => e.code === 'unknown-format' && /format 3/.test(e.message),
  );

  // A header asking for a key derivation too costly to run is refused before it runs.
  const costly = Buffer.from(
    sealed.toString('latin1').replace(`"N":${2 ** 14}`, `"N":${2 ** 20}`),
    'latin1',
  );
  writeFileSync(file, costly);
  await assert.rejects(
    importStore({ ...opts(join(dir, 'b'), file), passphrase: PASS }),
    (/** @type {any} */ e) => e.code === 'bad-header' && /scrypt N/.test(e.message),
  );
  // An age file whose payload is not an export is refused as damaged.
  const { encrypt } = await import('../lib/store/age.mjs');
  writeFileSync(file, encrypt(Buffer.from('not an export\n'), [DEVICE.recipient]));
  await assert.rejects(importStore(opts(join(dir, 'b'), file)), { code: 'damaged' });
});

const AGE = ['age', 'age-keygen'].every(
  (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0,
);

test(
  'an export opens with the age program, and a store file age writes imports',
  { skip: AGE ? false : 'the age program (age, age-keygen) is not installed; interop not tested' },
  async () => {
    const { dir, file } = fixture();
    const a = openStore(join(dir, 'a'));
    question(a, 'E-1', 1);
    const out = exportStore(opts(a.root, file));
    const key = join(dir, 'device.txt');
    writeFileSync(key, `${DEVICE.identity}\n`, { mode: 0o600 });
    const plain = spawnSync('age', ['-d', '-i', key, file], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(plain.status, 0, plain.stderr?.toString());
    const manifest = JSON.parse(plain.stdout.subarray(0, plain.stdout.indexOf(0x0a)).toString());
    assert.equal(manifest.head, out.head);
    // age re-encrypts the same payload to another key; the store imports it.
    const again = spawnSync('age', ['-r', OTHER_DEVICE.recipient], {
      input: plain.stdout,
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(again.status, 0, again.stderr?.toString());
    const theirs = join(dir, 'from-age.hitld');
    writeFileSync(theirs, again.stdout);
    const r = await importStore({
      ...opts(join(dir, 'b'), theirs),
      identities: [OTHER_DEVICE.identity],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.head, out.head);
  },
);

test('a conflict stops the import with nothing written: the same event ID twice, or a file changed on both sides', async () => {
  const { dir, file } = fixture();
  const a = openStore(join(dir, 'a'));
  const b = openStore(join(dir, 'b'));
  question(a, 'E-1', 1);
  a.write('precedents/P-1.json', '{"v":0}\n');
  exportStore(opts(a.root, file));
  await importStore(opts(b.root, file));

  // Each machine allocates the next ID on its own: two different E-2 events.
  question(a, 'E-2', 2);
  question(b, 'E-2', 3);
  exportStore(opts(a.root, file));
  const ledgerBefore = b.read('ledger.jsonl');
  const headBefore = snapshot(b.root, 'test');
  const r = await importStore(opts(b.root, file));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'conflict');
  assert.deepEqual(r.conflicts, [
    { path: 'ledger.jsonl', why: 'E-2 was written with different content on each side' },
  ]);
  assert.equal(b.read('ledger.jsonl'), ledgerBefore);
  assert.equal(head(b.root), headBefore);

  // A plain file both sides changed.
  const c = openStore(join(dir, 'c'));
  exportStore(opts(a.root, file));
  const d = join(dir, 'd.hitld');
  await importStore(opts(c.root, file));
  a.write('precedents/P-1.json', '{"v":1}\n');
  c.write('precedents/P-1.json', '{"v":2}\n');
  exportStore(opts(a.root, d));
  const r2 = await importStore(opts(c.root, d));
  assert.equal(r2.ok, false);
  assert.deepEqual(r2.conflicts, [{ path: 'precedents/P-1.json', why: 'changed on both sides' }]);
  assert.equal(c.read('precedents/P-1.json'), '{"v":2}\n');
});

test('a machine-local file that arrives in a bundle is refused', async () => {
  const { dir, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  snapshot(a.root, 'first');
  a.write('run-state.json', '{}\n');
  git(a.root, ['add', '-f', 'run-state.json']);
  git(a.root, ['commit', '-q', '-m', 'force a machine-local file in']);
  exportStore(opts(a.root, file));
  const r = await importStore(opts(join(dir, 'b'), file));
  assert.equal(r.ok, false);
  assert.equal(r.conflicts?.[0].path, 'run-state.json');
  assert.equal(existsSync(join(dir, 'b', 'run-state.json')), false);
});

test('append-only merge: the same result from either side; a removed line is a conflict', () => {
  const base = Buffer.from('{"id":"E-1","at":"1"}\n');
  const ours = Buffer.from('{"id":"E-1","at":"1"}\n{"id":"E-3","at":"3"}\n');
  const theirs = Buffer.from('{"id":"E-1","at":"1"}\n{"id":"E-2","at":"2"}\n');
  const x = mergeAppendOnly(base, ours, theirs);
  const y = mergeAppendOnly(base, theirs, ours);
  assert.deepEqual(x, y);
  assert.deepEqual(x, {
    text: '{"id":"E-1","at":"1"}\n{"id":"E-2","at":"2"}\n{"id":"E-3","at":"3"}\n',
  });
  assert.match(
    /** @type {any} */ (mergeAppendOnly(base, Buffer.from('{"id":"E-3","at":"3"}\n'), theirs)).why,
    /removed or changed in this store/,
  );
  assert.equal(isMachineLocal('index.sqlite-wal'), true);
  assert.equal(isMachineLocal('run/checkpoints/slot-1.json'), true);
  assert.equal(isMachineLocal('ledger.jsonl'), false);
});

test('the index is a cache: deleted, it is rebuilt from the ledger', async () => {
  const { dir } = fixture();
  const a = openStore(join(dir, 'a'));
  for (let n = 1; n <= 3; n++) question(a, `E-${n}`, n);
  assert.equal(await readIndex(a), null);
  const built = await rebuildIndex(a);
  assert.equal(built.events, 3);
  rmSync(join(a.root, INDEX_FILE));
  assert.equal(await readIndex(a), null);
  await rebuildIndex(a);
  assert.deepEqual(await readIndex(a), { events: 3, index_version: 1 });
});

/** @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} env */
async function hitld(argv, cwd, env) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, json: JSON.parse(out) };
}

test('the commands refuse executors, want their keys, and never take a secret as an argument', async () => {
  const { dir, project, file } = fixture();
  const store = join(dir, 'a');
  const to = ['--recipient', DEVICE.recipient];
  for (const sub of ['export', 'import', 'sync']) {
    for (const env of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-3' }]) {
      const r = await hitld(
        ['store', sub, file, '--store', store, ...(sub === 'import' ? [] : to)],
        project,
        {
          ...env,
          HITLD_STORE_IDENTITY: DEVICE.identity,
        },
      );
      assert.equal(r.code, EXIT.failed, sub);
      assert.equal(r.json.error, 'not-permitted', sub);
    }
    for (const secret of ['--passphrase', '--identity']) {
      const arg = await hitld(['store', sub, file, secret, 'x'], project, {});
      assert.equal(arg.code, EXIT.usage, `${sub} ${secret}`);
    }
  }
  // Export and sync need a recipient; import needs a file.
  for (const sub of ['export', 'sync']) {
    const none = await hitld(['store', sub, file, '--store', store], project, {});
    assert.equal(none.json.error, 'no-recipients', sub);
    const bad = await hitld(
      ['store', sub, file, '--store', store, '--recipient', 'age1x'],
      project,
      {},
    );
    assert.equal(bad.json.error, 'age-bad-recipient', sub);
  }
  const missing = await hitld(['store', 'import', file, '--store', store], project, {});
  assert.equal(missing.json.error, 'no-file');
  assert.equal(existsSync(file), false);

  // A format-2 file wants an age private key; a format-1 file wants the passphrase.
  const a = openStore(join(dir, 'src'));
  question(a, 'E-1', 1);
  exportStore(opts(a.root, file));
  const noKey = await hitld(['store', 'import', file, '--store', store], project, {
    HITLD_STORE_PASSPHRASE: PASS,
  });
  assert.equal(noKey.json.error, 'no-identity');
  assert.match(noKey.json.message, /HITLD_STORE_IDENTITY/);
  const noPass = await hitld(['store', 'import', FORMAT_1_FIXTURE, '--store', store], project, {
    HITLD_STORE_IDENTITY: DEVICE.identity,
  });
  assert.equal(noPass.json.error, 'no-passphrase');
  const syncNoKey = await hitld(['store', 'sync', file, '--store', store, ...to], project, {});
  assert.equal(syncNoKey.json.error, 'no-identity');
});

test('from the command line: export to two recipients, import with a key from a file descriptor or the environment', async () => {
  const { dir, project, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  const out = await hitld(
    [
      'store',
      'export',
      file,
      '--store',
      a.root,
      '--recipient',
      DEVICE.recipient,
      '--recipient',
      OTHER_DEVICE.recipient,
    ],
    project,
    {},
  );
  assert.equal(out.code, EXIT.ok, JSON.stringify(out.json));
  assert.equal(out.json.format, 2);
  assert.equal(out.json.recipients, 2);

  const b = join(dir, 'b');
  const wrong = await hitld(['store', 'import', file, '--store', b], project, {
    HITLD_STORE_IDENTITY: STRANGER.identity,
  });
  assert.equal(wrong.json.error, 'age-no-match');
  const malformed = await hitld(['store', 'import', file, '--store', b], project, {
    HITLD_STORE_IDENTITY: 'AGE-SECRET-KEY-1NOTAKEY',
  });
  assert.equal(malformed.json.error, 'age-bad-identity');
  assert.doesNotMatch(malformed.json.message, /NOTAKEY/);

  // An identity file as age-keygen writes it, read from a file descriptor.
  const secret = join(dir, 'identity.txt');
  writeFileSync(
    secret,
    `# created: 2026-11-15T10:00:00Z\n# public key: ${OTHER_DEVICE.recipient}\n${OTHER_DEVICE.identity}\n`,
  );
  const fd = openSync(secret, 'r');
  try {
    const ok = await hitld(
      ['store', 'import', file, '--store', b, '--identity-fd', String(fd)],
      project,
      {},
    );
    assert.equal(ok.code, EXIT.ok, JSON.stringify(ok.json));
    assert.equal(ok.json.format, 2);
    assert.equal(ok.json.index.events, 1);
  } finally {
    closeSync(fd);
  }
  assert.equal(openStore(b).read('ledger.jsonl'), a.read('ledger.jsonl'));

  const c = join(dir, 'c');
  const env = await hitld(['store', 'import', file, '--store', c], project, {
    HITLD_STORE_IDENTITY: DEVICE.identity,
  });
  assert.equal(env.code, EXIT.ok, JSON.stringify(env.json));

  // A format-1 file imports with the passphrase from the environment.
  const d = join(dir, 'd');
  const old = await hitld(['store', 'import', FORMAT_1_FIXTURE, '--store', d], project, {
    HITLD_STORE_PASSPHRASE: PASS,
  });
  assert.equal(old.code, EXIT.ok, JSON.stringify(old.json));
  assert.equal(old.json.format, 1);
});

test('the command line prints no SQLite experimental warning, and keeps other warnings', () => {
  const { dir, project, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, HITLD_STORE_IDENTITY: DEVICE.identity };
  delete env.HITLD_ROLE;
  delete env.HITLD_DISPATCH;
  delete env.NODE_OPTIONS;
  const run = (/** @type {string[]} */ args) =>
    spawnSync(process.execPath, [BIN, ...args], { cwd: project, env, encoding: 'utf8' });
  assert.equal(
    run(['store', 'export', file, '--store', a.root, '--recipient', DEVICE.recipient]).status,
    0,
  );
  const r = run(['store', 'import', file, '--store', join(dir, 'b')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /ExperimentalWarning|SQLite/);
  // Another warning, emitted in the same process before the command runs, still prints.
  const other = spawnSync(
    process.execPath,
    [
      '--import',
      'data:text/javascript,setTimeout(()=>process.emitWarning("kept","ExperimentalWarning"))',
      BIN,
      'version',
    ],
    { cwd: project, env, encoding: 'utf8' },
  );
  assert.match(other.stderr, /ExperimentalWarning: kept/);
});
