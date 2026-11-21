import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main, EXIT } from '../lib/cli/main.mjs';
import { policyDefaults } from '../lib/policy/policy.mjs';
import { openStore } from '../lib/store/store.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { loadState } from '../lib/run/checkpoint.mjs';
import { Run } from '../lib/run/run.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { tempDir } from './helpers/tmp.mjs';

const dir = tempDir('hitld-ledger-cli-');
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
  assert.deepEqual(noLease.json.differs, ['session']);
  assert.match(
    noLease.json.message,
    /held by session s-1 on example-laptop, not by this session \(s-2\): the session differs/,
  );
  // Without flags, the session and host are the ones run start recorded for this worktree.
  const bare = await hitld(['ledger', 'append', q, '--store', store]);
  assert.equal(bare.code, EXIT.ok, JSON.stringify(bare.json));
  assert.deepEqual([bare.json.event.session, bare.json.event.host], ['s-1', 'example-laptop']);

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
    bare.json.event.id,
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

/** hitld in a working directory of its own. @param {string} cwd @param {string[]} argv @param {NodeJS.ProcessEnv} [env] */
async function hitldIn(cwd, argv, env = {}) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, json: JSON.parse(out) };
}

test('hitld: the session comes from --session, HITLD_SESSION, the harness, or run start', async () => {
  const { hostname } = await import('node:os');
  const { mkdirSync } = await import('node:fs');
  const here = join(dir, 'identity');
  mkdirSync(here);
  const other = join(dir, 'identity-store');
  const q = JSON.stringify({ event: 'asked', decision: 'W-60' });

  // Nothing gives one: run start makes one and records it; later calls read it back.
  const made = await hitldIn(here, ['run', 'start', '--store', other]);
  assert.equal(made.code, EXIT.ok, JSON.stringify(made.json));
  assert.match(made.json.identity.session, /^s-[0-9a-f]{12}$/);
  assert.deepEqual([made.json.identity.host, made.json.identity.source], [hostname(), 'new']);
  assert.equal(made.json.handover.lease.session, made.json.identity.session);
  assert.equal((await hitldIn(here, ['run', 'checkpoint', '--store', other])).code, EXIT.ok);
  const appended = await hitldIn(here, ['ledger', 'append', q, '--store', other]);
  assert.equal(appended.json.event.session, made.json.identity.session);

  // The harness's session ID comes before the record; HITLD_SESSION and --session before that.
  const harness = { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_other' };
  const viaHarness = await hitldIn(here, ['run', 'checkpoint', '--store', other], harness);
  assert.deepEqual([viaHarness.json.error, viaHarness.json.differs], ['lease-lost', ['session']]);
  assert.match(viaHarness.json.message, /not by this session \(cse_other\)/);
  const viaEnv = await hitldIn(here, ['run', 'checkpoint', '--store', other], {
    ...harness,
    HITLD_SESSION: made.json.identity.session,
  });
  assert.equal(viaEnv.code, EXIT.ok, JSON.stringify(viaEnv.json));
  const viaFlag = await hitldIn(here, ['run', 'checkpoint', '--store', other, '--session', 's-9'], {
    HITLD_SESSION: made.json.identity.session,
  });
  assert.equal(viaFlag.json.error, 'lease-lost');

  // An executor shares its orchestrator's harness variables and checkout: it gets neither.
  const executor = await hitldIn(here, ['run', 'checkpoint', '--store', other], {
    ...harness,
    HITLD_ROLE: 'executor',
  });
  assert.deepEqual([executor.code, executor.json.error], [EXIT.failed, 'usage']);
  assert.match(executor.json.message, /session ID is needed/);

  // Elsewhere, with nothing recorded, only run start makes one.
  const elsewhere = join(dir, 'identity-elsewhere');
  mkdirSync(elsewhere);
  const none = await hitldIn(elsewhere, ['run', 'checkpoint', '--store', other]);
  assert.deepEqual([none.code, none.json.error], [EXIT.failed, 'usage']);
  const ok = await hitldIn(elsewhere, ['run', 'start', '--store', join(dir, 'identity-store-2')], {
    HITLD_SESSION: 's-9',
  });
  assert.deepEqual([ok.json.handover.lease.session, ok.json.identity.source], ['s-9', 'env']);
});

test('hitld: the host run start took holds for the session, and a host mismatch says so', async () => {
  const { mkdirSync } = await import('node:fs');
  const here = join(dir, 'host');
  mkdirSync(here);
  const s = ['--store', join(dir, 'host-store')];
  const started = await hitldIn(here, [
    'run',
    'start',
    ...s,
    '--session',
    's-h',
    '--host',
    'far-box',
  ]);
  assert.deepEqual(started.json.identity, { session: 's-h', host: 'far-box', source: 'flag' });
  // The same session, without --host: the recorded host, so the lease still holds.
  assert.equal(
    (await hitldIn(here, ['run', 'checkpoint', ...s, '--session', 's-h'])).code,
    EXIT.ok,
  );
  assert.equal((await hitldIn(here, ['run', 'checkpoint', ...s])).code, EXIT.ok);

  // Only the host differs: the session holds the lease, and the refusal says so.
  const moved = await hitldIn(here, ['run', 'checkpoint', ...s, '--host', 'near-box']);
  assert.deepEqual([moved.code, moved.json.error], [EXIT.failed, 'lease-host-mismatch']);
  assert.deepEqual(moved.json.differs, ['host']);
  assert.equal(moved.json.holder.session, 's-h');
  assert.match(
    moved.json.message,
    /this session \(s-h\) holds the lease on run .+ on host far-box, but this call gives host near-box/,
  );
  assert.doesNotMatch(moved.json.message, /not by this session/);

  // Both differ: lost, naming both.
  const both = await hitldIn(here, [
    'run',
    'checkpoint',
    ...s,
    '--session',
    's-x',
    '--host',
    'near-box',
  ]);
  assert.deepEqual([both.json.error, both.json.differs], ['lease-lost', ['session', 'host']]);
  assert.match(
    both.json.message,
    /not by this session \(s-x on near-box\): the session and the host differ/,
  );
});

test("hitld: with a project policy, the store is the project's private store", async () => {
  const repo = tempDir('hitld-ledger-repo-');
  const xdg = tempDir('hitld-ledger-xdg-');
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
  const { events } = readLedger(openStore(root));
  assert.equal(events.length, 1);
  assert.ok(existsSync(join(root, 'run-state.json')));
  const [started] = events;
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
  assert.equal(sv.json.event.schema_version, 3);
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
