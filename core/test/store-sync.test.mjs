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
import { open, seal } from '../lib/store/sealed.mjs';
import { git, head, isMachineLocal, mergeAppendOnly, snapshot } from '../lib/store/git.mjs';
import { INDEX_FILE, readIndex, rebuildIndex } from '../lib/store/index-db.mjs';

const BIN = fileURLToPath(new URL('../bin/hitld.mjs', import.meta.url));
/** Cheaper than the default cost, inside the bounds a file may name. */
const scrypt = { N: 2 ** 14, r: 8, p: 1 };
const PASS = 'a long passphrase for tests';
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
  passphrase: PASS,
  scrypt,
});

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
  const bytes = readFileSync(file);
  assert.ok(!bytes.includes(Buffer.from('W-1')), 'the file is encrypted');
  assert.ok(!bytes.includes(Buffer.from('P-1')), 'the file is encrypted');

  // What the bundle holds: the text, no machine-local file, no index.
  const committed = git(a.root, ['ls-tree', '-r', '--name-only', out.head])
    .stdout.toString('utf8')
    .trim()
    .split('\n');
  assert.deepEqual(committed.sort(), ['.gitignore', 'ledger.jsonl', 'precedents/P-1.json']);

  const b = openStore(join(dir, 'stores', 'b'));
  const r = await importStore(opts(b.root, file));
  assert.equal(r.ok, true);
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
  question(a, 'E-1', 1);
  await syncStore(opts(a.root, file)); // a writes the file
  await syncStore(opts(b.root, file)); // b takes it and writes back
  assert.equal(b.read('ledger.jsonl'), a.read('ledger.jsonl'));

  // Distinct event IDs on each side (as reserved ID blocks would give), plus a file only one side changed.
  question(a, 'E-a1', 3);
  question(b, 'E-b1', 2);
  b.append('trust/events.jsonl', '{"area":"cache","at":"2026-11-14T10:05:00Z"}\n');
  const toA = await syncStore(opts(b.root, file));
  assert.equal(toA.ok, true);
  const back = await syncStore(opts(a.root, file));
  assert.equal(back.ok, true);
  assert.equal(back.imported?.ok && back.imported.result, 'merged');
  const toB = await syncStore(opts(b.root, file));
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

test('a wrong passphrase is refused, and nothing changes', async () => {
  const { dir, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  exportStore(opts(a.root, file));
  const b = join(dir, 'b');
  await assert.rejects(
    importStore({ ...opts(b, file), passphrase: 'not the passphrase' }),
    (/** @type {any} */ e) => e.code === 'cannot-open' && /passphrase is wrong/.test(e.message),
  );
  assert.equal(existsSync(join(b, 'ledger.jsonl')), false);
});

test('a file with one flipped byte is refused, wherever the byte is', async () => {
  const { dir, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  exportStore(opts(a.root, file));
  const good = readFileSync(file);
  const headerEnd = good.indexOf(0x0a);
  // In the header (the salt's first character), the body, and the tag.
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
      importStore(opts(join(dir, `b-${where}`), tampered)),
      (/** @type {any} */ e) => ['cannot-open', 'bad-header'].includes(e.code),
      where,
    );
  }
  // The untouched file still opens.
  assert.equal(open(good, PASS).manifest.project, 'fixture');
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

test('a newer schema, or an unknown export format, is refused', async () => {
  const { dir, file } = fixture();
  const registry = schemas();
  const versions = /** @type {Record<string, number>} */ (
    Object.fromEntries(registry.versionedIds().map((id) => [id, registry.currentVersion(id)]))
  );
  const manifest = {
    project: 'fixture',
    schema_versions: { ...versions, 'ledger-entry': (versions['ledger-entry'] ?? 1) + 1 },
    head: '0'.repeat(40),
    branch: 'main',
    created_at: at(1),
    hitld_version: '9.0.0',
  };
  writeFileSync(file, seal(manifest, Buffer.from('bundle'), PASS, { scrypt }));
  await assert.rejects(
    importStore(opts(join(dir, 'b'), file)),
    (/** @type {any} */ e) => e.code === 'newer-schema' && /ledger-entry/.test(e.message),
  );

  const sealed = seal({ ...manifest, schema_versions: versions }, Buffer.from('x'), PASS, {
    scrypt,
  });
  const future = Buffer.from(
    sealed.toString('latin1').replace('"format":1', '"format":2'),
    'latin1',
  );
  writeFileSync(file, future);
  await assert.rejects(
    importStore(opts(join(dir, 'b'), file)),
    (/** @type {any} */ e) => e.code === 'unknown-format' && /format 2/.test(e.message),
  );

  // A header asking for a key derivation too costly to run is refused before it runs.
  const costly = Buffer.from(
    sealed.toString('latin1').replace(`"N":${2 ** 14}`, `"N":${2 ** 20}`),
    'latin1',
  );
  writeFileSync(file, costly);
  await assert.rejects(
    importStore(opts(join(dir, 'b'), file)),
    (/** @type {any} */ e) => e.code === 'bad-header' && /scrypt N/.test(e.message),
  );
});

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

test('the commands refuse executors, want a passphrase, and never take one as an argument', async () => {
  const { dir, project, file } = fixture();
  const store = join(dir, 'a');
  for (const sub of ['export', 'import', 'sync']) {
    for (const env of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-3' }]) {
      const r = await hitld(['store', sub, file, '--store', store], project, {
        ...env,
        HITLD_STORE_PASSPHRASE: PASS,
      });
      assert.equal(r.code, EXIT.failed, sub);
      assert.equal(r.json.error, 'not-permitted', sub);
    }
    const none = await hitld(['store', sub, file, '--store', store], project, {});
    assert.equal(none.json.error, 'no-passphrase', sub);
    const arg = await hitld(['store', sub, file, '--passphrase', PASS], project, {});
    assert.equal(arg.code, EXIT.usage, sub);
  }
  assert.equal(existsSync(file), false);
});

test('from the command line: export with the passphrase from a file descriptor, import with it from the environment', async () => {
  const { dir, project, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  const secret = join(dir, 'passphrase.txt');
  writeFileSync(secret, `${PASS}\n`);
  const fd = openSync(secret, 'r');
  try {
    const out = await hitld(
      ['store', 'export', file, '--store', a.root, '--passphrase-fd', String(fd)],
      project,
      {},
    );
    assert.equal(out.code, EXIT.ok, JSON.stringify(out.json));
  } finally {
    closeSync(fd);
  }
  const b = join(dir, 'b');
  const wrong = await hitld(['store', 'import', file, '--store', b], project, {
    HITLD_STORE_PASSPHRASE: 'wrong',
  });
  assert.equal(wrong.json.error, 'cannot-open');
  const ok = await hitld(['store', 'import', file, '--store', b], project, {
    HITLD_STORE_PASSPHRASE: PASS,
  });
  assert.equal(ok.code, EXIT.ok, JSON.stringify(ok.json));
  assert.equal(ok.json.index.events, 1);
  assert.equal(openStore(b).read('ledger.jsonl'), a.read('ledger.jsonl'));
});

test('the command line prints no SQLite experimental warning, and keeps other warnings', () => {
  const { dir, project, file } = fixture();
  const a = openStore(join(dir, 'a'));
  question(a, 'E-1', 1);
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, HITLD_STORE_PASSPHRASE: PASS };
  delete env.HITLD_ROLE;
  delete env.HITLD_DISPATCH;
  delete env.NODE_OPTIONS;
  const run = (/** @type {string[]} */ args) =>
    spawnSync(process.execPath, [BIN, ...args], { cwd: project, env, encoding: 'utf8' });
  assert.equal(run(['store', 'export', file, '--store', a.root]).status, 0);
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
