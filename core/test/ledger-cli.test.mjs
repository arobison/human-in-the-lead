import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, EXIT } from '../lib/cli/main.mjs';
import { policyDefaults } from '../lib/policy/policy.mjs';
import { openStore } from '../lib/store/store.mjs';
import { loadState } from '../lib/run/checkpoint.mjs';
import { Run } from '../lib/run/run.mjs';
import { schemas } from '../lib/schema/registry.mjs';

const dir = mkdtempSync(join(tmpdir(), 'hitld-ledger-cli-'));
const store = join(dir, 'store');

/** @param {string[]} argv @param {NodeJS.ProcessEnv} [env] */
async function hitld(argv, env = {}) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd: dir, env });
  return { code, json: JSON.parse(out) };
}

test('policy: the run and orchestrator sections have documented defaults', () => {
  const p = policyDefaults();
  assert.equal(p.run.checkpoints_kept, 5);
  assert.equal(p.run.lease_expiry_seconds, 1800);
  assert.equal(p.orchestrator.handover_context_share, 0.7);
  assert.deepEqual(
    schemas()
      .validateEntity('policy', {
        schema_version: 1,
        project: { id: 'x', key: 'W' },
        run: { checkpoints_kept: 0 },
      })
      .map((e) => e.path),
    ['run.checkpoints_kept'],
  );
});

test('hitld: a run from the command line, with a second session taking over', async () => {
  const started = await hitld([
    'run',
    'start',
    '--store',
    store,
    '--session',
    's-1',
    '--host',
    'example-laptop',
    '--scope',
    '{"items":["W-1"]}',
  ]);
  assert.equal(started.code, EXIT.ok);
  assert.equal(started.json.run.id.length > 0, true);
  assert.equal(started.json.handover.lease.session, 's-1');

  const event = JSON.stringify({
    id: 'dispatched-D-1',
    event: 'dispatched',
    dispatch: 'D-1',
    item: 'W-1',
    role: 'executor',
    tier: 2,
    host: 'example-laptop',
  });
  // raw append writes only an allowlist of events: no dispatch, report, abandon, release, run or lease events, whoever asks
  const refused0 = await hitld([
    'ledger',
    'append',
    event,
    '--store',
    store,
    '--session',
    's-1',
    '--host',
    'example-laptop',
  ]);
  assert.deepEqual([refused0.code, refused0.json.error], [EXIT.failed, 'forbidden-event']);
  const me0 = ['--store', store, '--session', 's-1', '--host', 'example-laptop'];
  // a forged terminal event, and an event type not on the list, are refused
  for (const forged of [
    { event: 'reported', dispatch: 'D-1', item: 'W-1', result: 'done' },
    { event: 'abandoned', dispatch: 'D-1', item: 'W-1' },
    { event: 'unclaimed', dispatch: 'D-1', item: 'W-1' },
    { event: 'started', dispatch: 'D-1', item: 'W-1', harness: 'x', harness_ref: 'y' },
    { event: 'lease-taken', run: 'x', session: 's-1', host: 'example-laptop' },
    { event: 'run-started', run: 'x', session: 's-1', host: 'example-laptop' },
    { event: 'no-such-event' },
  ]) {
    const r = await hitld(['ledger', 'append', JSON.stringify(forged), ...me0]);
    assert.deepEqual([r.code, r.json.error], [EXIT.failed, 'forbidden-event'], forged.event);
  }
  // the run module writes it
  const diskStore = openStore(store);
  const state = /** @type {any} */ (loadState(diskStore).state);
  new Run(diskStore, { session: 's-1', host: 'example-laptop' }, state).record(JSON.parse(event));

  const q = JSON.stringify({ id: 'q-1', event: 'asked', decision: 'W-50' });
  const me = ['--store', store, '--session', 's-1', '--host', 'example-laptop'];
  const appended = await hitld(['ledger', 'append', q, ...me]);
  assert.deepEqual([appended.code, appended.json.appended], [EXIT.ok, true]);
  // the caller's id, run and time are overwritten
  assert.notEqual(appended.json.event.id, 'q-1');
  const forgedFields = await hitld([
    'ledger',
    'append',
    JSON.stringify({
      id: 'dispatched-D-1',
      run: 'someone-elses',
      at: '1999-01-01',
      event: 'asked',
      decision: 'W-51',
    }),
    ...me,
  ]);
  assert.equal(forgedFields.code, EXIT.ok);
  assert.notEqual(forgedFields.json.event.id, 'dispatched-D-1');
  assert.equal(forgedFields.json.event.run, loadState(openStore(store)).state?.run.id);
  assert.notEqual(forgedFields.json.event.at, '1999-01-01');
  // An event no dispatch writes says which session and machine wrote it.
  assert.deepEqual(
    [forgedFields.json.event.session, forgedFields.json.event.host],
    ['s-1', 'example-laptop'],
  );
  // the run state caught up with the appended event
  assert.equal(loadState(diskStore).state?.decisions_open.length, 2);

  const noLease = await hitld([
    'ledger',
    'append',
    q,
    '--store',
    store,
    '--session',
    's-2',
    '--host',
    'example-laptop',
  ]);
  assert.deepEqual([noLease.code, noLease.json.error], [EXIT.failed, 'lease-lost']);
  assert.equal(
    (await hitld(['ledger', 'append', q, '--store', store])).code,
    EXIT.failed,
    'no session, no append',
  );

  const bad = await hitld(['ledger', 'append', '{"event":"merged"}', ...me]);
  assert.equal(bad.code, EXIT.failed);
  assert.equal(bad.json.error, 'invalid-event');
  assert.equal((await hitld(['ledger', 'append', 'nope', ...me])).json.error, 'usage');

  const inflight = await hitld(['ledger', 'in-flight', '--store', store]);
  assert.deepEqual(
    inflight.json.in_flight.map((/** @type {any} */ d) => d.dispatch),
    ['D-1'],
  );
  assert.equal(
    (await hitld(['ledger', 'tail', '--store', store, '--limit', '1'])).json.events[0].id,
    forgedFields.json.event.id,
  );

  // the lease is held by s-1, so s-2 is refused, and may be sent in by the owner with --force
  const refused = await hitld([
    'run',
    'resume',
    '--store',
    store,
    '--session',
    's-2',
    '--host',
    'example-laptop',
  ]);
  assert.equal(refused.code, EXIT.failed);
  assert.equal(refused.json.error, 'lease-held');
  assert.equal(refused.json.holder.session, 's-1');
  assert.equal(
    (
      await hitld([
        'run',
        'checkpoint',
        '--store',
        store,
        '--session',
        's-2',
        '--host',
        'example-laptop',
      ])
    ).json.error,
    'lease-lost',
  );

  const resumed = await hitld([
    'run',
    'resume',
    '--store',
    store,
    '--session',
    's-2',
    '--host',
    'example-laptop',
    '--force',
    '--live',
    'D-1',
  ]);
  assert.equal(resumed.code, EXIT.ok);
  assert.equal(resumed.json.took_over.reason, 'owner');
  assert.deepEqual(resumed.json.adopted, ['D-1']);
  assert.match(resumed.json.handover.text, /In flight \(1\): D-1 W-1 executor on example-laptop/);

  // told nothing is live, it abandons the dispatch and says which claim to release
  const none = await hitld([
    'run',
    'resume',
    '--store',
    store,
    '--session',
    's-2',
    '--host',
    'example-laptop',
    '--live',
    'none',
  ]);
  assert.deepEqual([none.json.abandoned, none.json.unclaim_items], [['D-1'], ['W-1']]);

  assert.equal((await hitld(['ledger', 'summary', '--store', store])).json.dispatches, 1);
  const rebuilt = await hitld(['run', 'rebuild', '--store', store]);
  assert.equal(rebuilt.code, EXIT.ok);
  assert.deepEqual(rebuilt.json.previous.changed, []);
});

test('hitld: the session comes from HITLD_SESSION, and is required', async () => {
  const other = join(dir, 'other-store');
  const none = await hitld(['run', 'start', '--store', other]);
  assert.equal(none.code, EXIT.failed);
  assert.match(none.json.message, /session ID is needed/);
  const ok = await hitld(['run', 'start', '--store', other], { HITLD_SESSION: 's-9' });
  assert.equal(ok.json.handover.lease.session, 's-9');
});

test("hitld: with a project policy, the store is the project's private store", async () => {
  const repo = mkdtempSync(join(tmpdir(), 'hitld-ledger-repo-'));
  const xdg = mkdtempSync(join(tmpdir(), 'hitld-ledger-xdg-'));
  const { mkdirSync, chmodSync, existsSync } = await import('node:fs');
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, '.human-in-the-lead'));
  const policy = join(repo, '.human-in-the-lead', 'policy.json');
  writeFileSync(
    policy,
    JSON.stringify({
      schema_version: 1,
      project: { id: 'ledger-fixture', key: 'W' },
      run: { checkpoints_kept: 2 },
    }),
  );
  chmodSync(policy, 0o600);
  let out = '';
  const code = await main(['run', 'start', '--session', 's-1'], {
    out: (t) => (out += t),
    err: () => {},
    cwd: repo,
    env: { XDG_DATA_HOME: xdg },
  });
  assert.equal(code, EXIT.ok, out);
  const root = join(xdg, 'human-in-the-lead', 'ledger-fixture');
  assert.ok(existsSync(join(root, 'ledger.jsonl')));
  assert.ok(existsSync(join(root, 'run-state.json')));
  const started = JSON.parse(readFileSync(join(root, 'ledger.jsonl'), 'utf8').trim());
  assert.match(started.policy_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(out).run.id.length > 0, true);
});

test('hitld ledger append: fields are allowlisted per event type, and corrections stay in raw-append types', async () => {
  const own = join(dir, 'fields-store');
  const me = ['--store', own, '--session', 's-1', '--host', 'example-laptop'];
  await hitld(['run', 'start', '--store', own, '--session', 's-1', '--host', 'example-laptop']);
  const diskStore = openStore(own);
  const lifecycle = new Run(
    diskStore,
    { session: 's-1', host: 'example-laptop' },
    /** @type {any} */ (loadState(diskStore).state),
  ).record({ event: 'dispatched', dispatch: 'D-1', item: 'W-1', role: 'executor', tier: 2 });
  /** @param {object} e */
  const append = (e) => hitld(['ledger', 'append', JSON.stringify(e), ...me]);

  // unknown fields are refused, naming them
  for (const [e, field] of /** @type {[object, string][]} */ ([
    [{ event: 'asked', decision: 'W-50', tokens: 5 }, 'tokens'],
    [{ event: 'asked', decision: 'W-50', serial_resources: ['gpu'] }, 'serial_resources'],
    [{ event: 'answered', decision: 'W-50', harness_ref: 'h' }, 'harness_ref'],
    [{ event: 'merged', item: 'W-1', role: 'executor' }, 'role'],
    [{ event: 'verified', item: 'W-1', result: 'pass', harness: 'x' }, 'harness'],
    [{ event: 'reverted', item: 'W-1', surprise: 1 }, 'surprise'],
    [{ event: 'logged', text: 'x', session: 's-forged' }, 'session'],
    [{ event: 'logged', text: 'x', host: 'forged' }, 'host'],
  ])) {
    const r = await append(e);
    assert.deepEqual([r.code, r.json.error], [EXIT.failed, 'forbidden-field'], field);
    assert.match(r.json.message, new RegExp(`not ${field}`));
  }

  // schema_version is the system's: dropped, not trusted
  const sv = await append({ event: 'asked', decision: 'W-50', schema_version: 99 });
  assert.equal(sv.code, EXIT.ok);
  assert.equal(sv.json.event.schema_version, 2);
  // The session and host are the caller's own, not a field it may set.
  assert.deepEqual([sv.json.event.session, sv.json.event.host], ['s-1', 'example-laptop']);

  // a correction may not rewrite a lifecycle event, or point at nothing
  const rewrite = await append({
    event: 'verified',
    item: 'W-1',
    result: 'pass',
    corrects: lifecycle.event.id,
  });
  assert.deepEqual([rewrite.code, rewrite.json.error], [EXIT.failed, 'forbidden-correction']);
  assert.match(rewrite.json.message, /a dispatched event/);
  const nowhere = await append({ event: 'merged', item: 'W-1', corrects: 'E-999' });
  assert.equal(nowhere.json.error, 'forbidden-correction');

  // nor a different kind of event, nor one about another item
  const wasFail = await append({ event: 'verified', item: 'W-1', result: 'fail', defects: 1 });
  const otherKind = await append({ event: 'merged', item: 'W-1', corrects: wasFail.json.event.id });
  assert.equal(otherKind.json.error, 'forbidden-correction');
  assert.match(otherKind.json.message, /earlier merged event/);
  const otherItem = await append({
    event: 'verified',
    item: 'W-2',
    result: 'pass',
    corrects: wasFail.json.event.id,
  });
  assert.equal(otherItem.json.error, 'forbidden-correction');

  // but one raw-append event may correct another of its kind about the same item
  const first = await append({ event: 'verified', item: 'W-1', result: 'fail', defects: 1 });
  const fix = await append({
    event: 'verified',
    item: 'W-1',
    result: 'pass',
    corrects: first.json.event.id,
  });
  assert.deepEqual([fix.code, fix.json.event.corrects], [EXIT.ok, first.json.event.id]);
  // the lifecycle event is untouched
  assert.deepEqual(
    (await hitld(['ledger', 'in-flight', '--store', own])).json.in_flight.map(
      (/** @type {any} */ d) => d.dispatch,
    ),
    ['D-1'],
  );
});
