import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, privateStorePath } from '../lib/store/store.mjs';

test('the default store path is ~/.local/share/human-in-the-lead/<project-id>/', () => {
  assert.equal(
    privateStorePath('example-project', { env: {}, home: '/home/o' }),
    '/home/o/.local/share/human-in-the-lead/example-project',
  );
});

test('XDG_DATA_HOME is respected when absolute', () => {
  assert.equal(
    privateStorePath('p', { env: { XDG_DATA_HOME: '/data' }, home: '/home/o' }),
    '/data/human-in-the-lead/p',
  );
  assert.equal(
    privateStorePath('p', { env: { XDG_DATA_HOME: 'relative' }, home: '/home/o' }),
    '/home/o/.local/share/human-in-the-lead/p',
  );
});

test('unsafe project IDs are refused', () => {
  for (const id of ['', '..', '../x', 'a/b', 'Upper', '.hidden', 'a..b']) {
    assert.throws(() => privateStorePath(id, { env: {}, home: '/h' }), /not a safe directory/, id);
  }
});

test('a store inside the repository is refused', () => {
  assert.throws(
    () =>
      privateStorePath('p', {
        env: { XDG_DATA_HOME: '/repo/data' },
        home: '/h',
        repoRoot: '/repo',
      }),
    /inside the repository/,
  );
  assert.doesNotThrow(() =>
    privateStorePath('p', { env: {}, home: '/home/o', repoRoot: '/home/o/src/repo' }),
  );
});

test('the store reads, writes atomically, appends and lists', () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'hitld-store-')), 'p'));
  assert.equal(store.read('ledger.jsonl'), null);
  assert.deepEqual(store.list(), []);
  store.append('ledger.jsonl', '{"a":1}\n');
  store.append('ledger.jsonl', '{"a":2}\n');
  store.write('runs/R-1/run-state.json', '{}');
  store.write('runs/R-1/run-state.json', '{"checkpoint":2}');
  assert.equal(store.read('ledger.jsonl'), '{"a":1}\n{"a":2}\n');
  assert.equal(store.read('runs/R-1/run-state.json'), '{"checkpoint":2}');
  assert.deepEqual(store.list(), ['ledger.jsonl', 'runs/R-1/run-state.json']);
  assert.deepEqual(store.list('runs/'), ['runs/R-1/run-state.json']);
});

test('store keys cannot leave the store', () => {
  const store = openStore(mkdtempSync(join(tmpdir(), 'hitld-store-')));
  for (const key of ['../x', '/etc/passwd', 'a/../../x', '', 'a\0b']) {
    assert.throws(() => store.read(key), /store key/, key);
  }
});
