// HITLD-74: ledger event and dispatch IDs are unique by construction, each writer appends to its
// own ledger file, and two stores that both appended sync with no conflict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { openStore } from '../lib/store/store.mjs';
import { appendEvent, nextDispatchId, readLedger } from '../lib/ledger/ledger.mjs';
import {
  DISPATCH_ID,
  LEGACY_DISPATCH_ID,
  isLegacyDispatch,
  newDispatchId,
  uniqueId,
} from '../lib/ledger/ids.mjs';
import {
  LEDGER_DIR,
  LEGACY_LEDGER_KEY,
  WRITER_KEY,
  ledgerKeyOf,
  ledgerKeys,
  resolveWriter,
  writerOfSession,
} from '../lib/ledger/writer.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { parseRefs } from '../lib/feedback/record.mjs';
import { isMachineLocal } from '../lib/store/git.mjs';
import { readIndex, readThroughIndex, rebuildIndex } from '../lib/store/index-db.mjs';
import { syncStore } from '../lib/store/sync.mjs';
import { generateIdentity } from '../lib/store/age.mjs';
import { memoryStore } from './helpers/memory-store.mjs';
import { tempDir } from './helpers/tmp.mjs';

const UNIQUE = /^D-[0-9A-HJKMNP-TV-Z]{16}$/;
const WRITER_A = 'w-aaaaaaaaaaaaaaaa';
const WRITER_B = 'w-bbbbbbbbbbbbbbbb';
const at = (/** @type {number} */ n) => `2026-11-20T10:${String(n).padStart(2, '0')}:00.000Z`;

test('IDs: a prefix and 16 base32 characters, time-ordered, and above the last one even when the clock steps back', () => {
  const t = new Date('2026-11-20T10:00:00Z');
  const a = uniqueId('D', { now: () => t, random: () => 5 });
  const b = uniqueId('D', { now: () => t, random: () => 1 }); // same millisecond, a lower draw
  const c = uniqueId('D', { now: () => new Date(t.getTime() - 60_000) }); // the clock stepped back
  const d = uniqueId('D', { now: () => new Date(t.getTime() + 1) });
  for (const id of [a, b, c, d]) assert.match(id, UNIQUE);
  assert.deepEqual([a, b, c, d], [a, b, c, d].toSorted());
  assert.equal(new Set([a, b, c, d]).size, 4);
  // A thousand in a row never repeat.
  const many = Array.from({ length: 1000 }, () => newDispatchId());
  assert.equal(new Set(many).size, 1000);
});

test('IDs: the numbered dispatches of before keep their meaning; both forms are valid wherever a dispatch is', () => {
  for (const old of ['D-1', 'D-38', 'D-40']) {
    assert.ok(DISPATCH_ID.test(old), old);
    assert.ok(isLegacyDispatch(old), old);
  }
  const fresh = newDispatchId();
  assert.ok(DISPATCH_ID.test(fresh));
  assert.equal(LEGACY_DISPATCH_ID.test(fresh), false);
  for (const bad of ['D-0', 'D-', 'D-01M7X6SAD7D16QN', 'D-01M7X6SAD7D16QNI', 'd-1']) {
    assert.equal(DISPATCH_ID.test(bad), false, bad);
  }
  // Feedback can be about either form, and about a unique event ID.
  const event = uniqueId('E');
  assert.deepEqual(parseRefs(`D-3, ${fresh} ${event} HITLD-74`), ['D-3', fresh, event, 'HITLD-74']);
  assert.throws(() => parseRefs('D-01M7X6SAD7D16QNI'), /not an ID/);
  // The schemas take both forms too.
  const registry = schemas();
  for (const dispatch of ['D-12', fresh]) {
    const line = {
      schema_version: 3,
      id: `dispatched-${dispatch}`,
      event: 'dispatched',
      at: at(1),
      dispatch,
      item: 'W-1',
    };
    assert.deepEqual(registry.validateEntity('ledger-entry', line), [], dispatch);
  }
  assert.notDeepEqual(
    registry.validateEntity('ledger-entry', {
      schema_version: 3,
      id: 'x',
      event: 'dispatched',
      at: at(1),
      dispatch: 'D-01M7X6SAD7D16QNI',
      item: 'W-1',
    }),
    [],
  );
});

test('each writer appends to its own file; the ledger is the union, the shared file of before first, then by time', () => {
  const files = new Map();
  const store = memoryStore(files);
  // A ledger written before the change: kept as it is, read first, never appended to.
  const old = [
    { schema_version: 2, id: 'E-1', event: 'dispatched', dispatch: 'D-38', item: 'W-1', at: at(0) },
    {
      schema_version: 2,
      id: 'E-2',
      event: 'reported',
      dispatch: 'D-38',
      item: 'W-1',
      result: 'done',
      at: at(5),
    },
  ];
  files.set(LEGACY_LEDGER_KEY, old.map((e) => `${JSON.stringify(e)}\n`).join(''));
  const legacyBefore = files.get(LEGACY_LEDGER_KEY);

  const da = nextDispatchId(store);
  const db = nextDispatchId(store);
  const a1 = appendEvent(
    store,
    { event: 'dispatched', dispatch: da, item: 'W-2', at: at(1) },
    { writer: WRITER_A },
  );
  const b1 = appendEvent(
    store,
    { event: 'dispatched', dispatch: db, item: 'W-3', at: at(2) },
    { writer: WRITER_B },
  );
  appendEvent(
    store,
    { event: 'reported', dispatch: da, item: 'W-2', result: 'done', at: at(3) },
    { writer: WRITER_A },
  );
  assert.equal(a1.file, ledgerKeyOf(WRITER_A));
  assert.equal(b1.file, ledgerKeyOf(WRITER_B));
  assert.equal(
    files.get(LEGACY_LEDGER_KEY),
    legacyBefore,
    'the shared file of before is never appended to',
  );
  assert.deepEqual(ledgerKeys(store), [
    LEGACY_LEDGER_KEY,
    ledgerKeyOf(WRITER_A),
    ledgerKeyOf(WRITER_B),
  ]);

  const read = readLedger(store);
  assert.deepEqual(read.problems, []);
  assert.deepEqual(
    read.events.map((e) => [e.dispatch, e.event]),
    [
      ['D-38', 'dispatched'],
      ['D-38', 'reported'],
      [da, 'dispatched'],
      [db, 'dispatched'],
      [da, 'reported'],
    ],
  );
  // The rules hold across files: a dispatch another writer ended cannot be revived.
  assert.throws(
    () =>
      appendEvent(store, { event: 'abandoned', dispatch: da, item: 'W-2' }, { writer: WRITER_B }),
    /already ended with reported/,
  );
  assert.throws(
    () =>
      appendEvent(
        store,
        { event: 'dispatched', dispatch: 'D-38', item: 'W-1' },
        { writer: WRITER_B },
      ),
    /already dispatched/,
  );
});

test('the same event two writers recorded before they synced is read once; one ID with other content is a problem', () => {
  const store = memoryStore();
  const fact = { id: 'merged-W-1-0123456789ab', event: 'merged', item: 'W-1' };
  appendEvent(store, { ...fact, at: at(1), session: 's-1' }, { writer: WRITER_A });
  // The other writer, before it saw the first one: as a sync brings it in.
  const line = { schema_version: 3, ...fact, at: at(2), session: 's-2' };
  store.append(ledgerKeyOf(WRITER_B), `${JSON.stringify(line)}\n`);
  assert.equal(readLedger(store).events.length, 1);
  assert.deepEqual(readLedger(store).problems, []);

  const other = {
    schema_version: 3,
    id: 'merged-W-1-0123456789ab',
    event: 'merged',
    item: 'W-2',
    at: at(3),
  };
  store.append(ledgerKeyOf(WRITER_B), `${JSON.stringify(other)}\n`);
  const read = readLedger(store);
  assert.equal(read.events.length, 1);
  assert.equal(read.events[0].item, 'W-1', 'the first is read');
  assert.equal(read.problems.length, 1);
  assert.equal(read.problems[0].file, ledgerKeyOf(WRITER_B));
  assert.match(read.problems[0].message, /also in ledger\/w-a+\.jsonl with other content/);
});

test('the writer: the session when one is known, never the harness session for an executor, else the store’s own on this machine', () => {
  const store = memoryStore();
  assert.equal(
    resolveWriter(store, { env: { HITLD_SESSION: 'orch-1' } }),
    writerOfSession('orch-1'),
  );
  assert.notEqual(writerOfSession('orch-1'), writerOfSession('cos'));
  assert.doesNotMatch(
    writerOfSession('orch-1'),
    /orch/,
    'the file name says nothing about the session',
  );
  const harness = { CLAUDE_CODE_SESSION_ID: 'abc-123' };
  assert.equal(resolveWriter(store, { env: harness }), writerOfSession('abc-123'));
  assert.equal(store.read(WRITER_KEY), null, 'a session needs no record');

  // An executor shares its orchestrator's harness variables: it does not write as it.
  const executor = resolveWriter(store, { env: { ...harness, HITLD_DISPATCH: 'D-40' } });
  assert.notEqual(executor, writerOfSession('abc-123'));
  assert.equal(resolveWriter(store, { env: {} }), executor, 'the store’s own writer, kept');
  assert.equal(JSON.parse(String(store.read(WRITER_KEY))).writer, executor);
  assert.ok(
    isMachineLocal(WRITER_KEY),
    'never committed or exported: another machine writes its own file',
  );
  assert.throws(() => resolveWriter(store, { writer: '../ledger' }), /not w-<16 hex>/);
});

test('the index ingests the union and numbers dispatches for people; a rebuild keeps the numbers it gave', async () => {
  const dir = tempDir('hitld-ledger-writers-');
  const store = openStore(join(dir, 'store'));
  store.append(
    LEGACY_LEDGER_KEY,
    `${JSON.stringify({ schema_version: 2, id: 'E-1', event: 'dispatched', dispatch: 'D-38', item: 'W-1', at: at(0) })}\n`,
  );
  const d1 = nextDispatchId(store);
  appendEvent(
    store,
    { event: 'dispatched', dispatch: d1, item: 'W-2', at: at(1) },
    { writer: WRITER_A },
  );
  const first = await rebuildIndex(store);
  assert.deepEqual(
    { events: first.events, dispatches: first.dispatches, files: first.files },
    { events: 2, dispatches: 2, files: 2 },
  );
  const numbersOf = async () =>
    Object.fromEntries((await readThroughIndex(store)).numbers.map((n) => [n.dispatch, n.number]));
  assert.deepEqual(await numbersOf(), { 'D-38': 1, [d1]: 2 });

  // A dispatch from another writer that sorts before d1 arrives later: d1 keeps its number.
  const early = 'D-01AAAAAAAAAAAAAA';
  appendEvent(
    store,
    { event: 'dispatched', dispatch: early, item: 'W-3', at: at(0) },
    { writer: WRITER_B },
  );
  assert.deepEqual(await numbersOf(), { 'D-38': 1, [d1]: 2, [early]: 3 });
  assert.deepEqual(await readIndex(store), { events: 3, dispatches: 3, index_version: 2 });
});

test('hitld ledger tail reads through the index and gives this machine’s display numbers', async () => {
  const dir = tempDir('hitld-ledger-writers-');
  const project = join(dir, 'project');
  mkdirSync(join(project, '.human-in-the-lead'), { recursive: true });
  mkdirSync(join(project, '.git'));
  writeFileSync(
    join(project, '.human-in-the-lead', 'policy.json'),
    JSON.stringify({ schema_version: 1, project: { id: 'fixture', key: 'W' } }),
  );
  const store = openStore(join(dir, 'store'));
  const d = nextDispatchId(store);
  appendEvent(store, { event: 'dispatched', dispatch: d, item: 'W-1' }, { writer: WRITER_A });
  appendEvent(store, { event: 'merged', item: 'W-9' }, { writer: WRITER_B });
  let out = '';
  const code = await main(['ledger', 'tail', '--store', store.root], {
    out: (t) => (out += t),
    err: () => {},
    cwd: project,
    env: {},
  });
  assert.equal(code, 0, out);
  const r = JSON.parse(out);
  assert.equal(r.total, 2);
  assert.deepEqual(
    r.events.map((/** @type {any} */ e) => e.event),
    ['dispatched', 'merged'],
  );
  assert.deepEqual(r.dispatch_numbers, { [d]: 1 });
});

test('two stores that both appended events and dispatches sync with no conflict, and the index shows the union', async () => {
  const dir = tempDir('hitld-ledger-writers-');
  const device = generateIdentity();
  const file = join(dir, 'store.hitld');
  const opts = (/** @type {string} */ root) => ({
    root,
    file,
    projectId: 'fixture',
    recipients: [device.recipient],
    identities: [device.identity],
  });
  // One store, then a second one in another container that took its history.
  const a = openStore(join(dir, 'a'));
  const b = openStore(join(dir, 'b'));
  const orch = { env: { HITLD_SESSION: 'orch-1' } };
  const cos = { env: { HITLD_SESSION: 'cos' } };
  const d0 = nextDispatchId(a);
  appendEvent(a, { event: 'dispatched', dispatch: d0, item: 'W-1' }, orch);
  assert.equal((await syncStore(opts(a.root))).ok, true);
  assert.equal((await syncStore(opts(b.root))).ok, true);

  // Between syncs both write: an orchestrator in one, the chief of staff in the other, each with
  // its own dispatches and events. With the numbered IDs of before, both would have taken the same
  // next numbers.
  const da = nextDispatchId(a);
  const db = nextDispatchId(b);
  appendEvent(a, { event: 'dispatched', dispatch: da, item: 'W-2' }, orch);
  appendEvent(a, { event: 'reported', dispatch: d0, item: 'W-1', result: 'done' }, orch);
  appendEvent(b, { event: 'dispatched', dispatch: db, item: 'W-3' }, cos);
  appendEvent(b, { event: 'asked', decision: 'W-4' }, cos);
  appendEvent(b, { event: 'logged', text: 'Started W-3 without asking.' }, cos);
  assert.notDeepEqual(ledgerKeys(a), ledgerKeys(b), 'each writer wrote its own file');

  // b syncs first (the file still holds what it already has), then a takes b's, then b takes a's.
  const fromB = await syncStore(opts(b.root));
  assert.equal(fromB.ok, true, JSON.stringify(fromB));
  const toA = await syncStore(opts(a.root));
  assert.equal(toA.ok, true, JSON.stringify(toA));
  assert.equal(toA.imported?.ok && toA.imported.result, 'merged');
  const back = await syncStore(opts(b.root));
  assert.equal(back.ok, true, JSON.stringify(back));

  for (const s of [a, b]) {
    const read = readLedger(s);
    assert.deepEqual(read.problems, []);
    assert.equal(read.events.length, 6);
    assert.deepEqual(
      new Set(read.events.filter((e) => e.event === 'dispatched').map((e) => e.dispatch)),
      new Set([d0, da, db]),
    );
    assert.equal(s.list(LEDGER_DIR).length, 2, 'one file per writer');
    assert.deepEqual(await readIndex(s), { events: 6, dispatches: 3, index_version: 2 });
  }
  assert.deepEqual(readLedger(a).events, readLedger(b).events, 'the same union, in the same order');
});
