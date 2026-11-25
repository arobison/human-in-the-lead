// The owner's run scope (HITLD-877): the owner says yes to one question whose title states items,
// a token budget and an end time, and the chief of staff starts those items itself, without the
// lease, within the cap and the quota gate. Every start derives the scope again from the owner's
// decision and the ledger; the store file grants nothing. Unit tests on run/scope.mjs, then the
// commands in a fixture consumer, then two sessions with two stores.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { Run, startRun } from '../lib/run/run.mjs';
import { loadState } from '../lib/run/checkpoint.mjs';
import { memoryStore } from './helpers/memory-store.mjs';
import {
  SCOPE_YES,
  scopeQuestion,
  checkScopeStart,
  deriveScope,
  ownerHoldsChanges,
  parseScopeTitle,
  readScopeFile,
  scopeTitle,
  spentOf,
  touchingOwnerPaths,
  unnamedItems,
  writeScopeFile,
} from '../lib/run/scope.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { main } from '../lib/cli/main.mjs';
import { generateIdentity } from '../lib/store/age.mjs';
import { buildConsumer, fixtureGit, writeSetupDone } from '../lib/eval/orchestrator-fixtures.mjs';
import { approve } from './helpers/devices.mjs';
import { tempDir } from './helpers/tmp.mjs';
import { STATUS_INPUT, git, item, makeConsumer, report } from './orchestrator-fixture.mjs';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const HOUR = 3600_000;
const iso = (/** @type {number} */ t) => new Date(t).toISOString();
const RUN = { id: 'R-1', started_at: iso(NOW - 2 * HOUR) };
const SPEC = { items: ['W-1', 'W-2'], budget_tokens: 100_000, until: iso(NOW + HOUR) };
/** The yes as the rights flow records it: the option as scopeQuestion wrote it. */
const YES = `A. ${SCOPE_YES}: ${scopeQuestion(SPEC, []).options[0].what_happens}`;
const ISSUED = () => iso(NOW - 2 * HOUR);

/** A decision item as the rights flow leaves it. @param {Record<string, unknown>} [over] */
const decision = (over = {}) => ({
  id: 'W-9',
  kind: 'decision',
  title: scopeTitle(SPEC),
  state: 'done',
  answer: YES,
  answered_by: 'owner',
  ...over,
});
/** The rights flow's answered event. @param {Record<string, unknown>} [over] */
const answered = (over = {}) =>
  /** @type {any} */ ({
    event: 'answered',
    decision: 'W-9',
    run: 'R-1',
    text: YES,
    at: iso(NOW - HOUR),
    ...over,
  });
/** @type {import('../lib/run/scope.mjs').ScopeFile} */
const FILE = { run: 'R-1', decision: 'W-9', set_at: iso(NOW - HOUR), set_by: 'cos' };

/** @param {Record<string, any>} [o] */
const start = (o = {}) =>
  checkScopeStart(o.file === undefined ? FILE : o.file, {
    decision: 'W-9',
    item: 'W-1',
    estimate: 40_000,
    now: NOW,
    run: RUN,
    events: [answered(), ...(o.events ?? [])],
    lookup: (id) => (id === 'W-9' ? decision(o.decision) : null),
    issuedAt: ISSUED,
    ...o.start,
  });

test('an ID is named only as a whole ID: not by W-12, nor by W-1-foo', () => {
  assert.deepEqual(unnamedItems('start W-1 and W-2', ['W-1', 'W-2']), []);
  assert.deepEqual(unnamedItems('W-12 and W-10', ['W-1']), ['W-1']);
  assert.deepEqual(unnamedItems('HITLD-87-foo', ['HITLD-87']), ['HITLD-87']);
  assert.deepEqual(unnamedItems('(W-1)', ['W-1']), []);
});

test('the scope is the title the owner read: written and read back, nothing else parses', () => {
  assert.deepEqual(parseScopeTitle(scopeTitle(SPEC)), SPEC);
  assert.equal(parseScopeTitle('Run scope: start W-1 within 10 tokens until tomorrow'), null);
  assert.equal(parseScopeTitle('Should we start W-1?'), null);
  assert.equal(parseScopeTitle(`Run scope: start W-1 within 0 tokens until ${SPEC.until}`), null);
});

test('a scope needs owner merge mode holding guard, policy, rights and skill paths', () => {
  const has = () => true;
  assert.equal(ownerHoldsChanges({ merge: { mode: 'queue' } }, has).ok, false);
  const narrow = ownerHoldsChanges({ merge: { mode: 'owner', owner_paths: ['src/**'] } }, has);
  assert.equal(!narrow.ok && narrow.code, 'scope-merge-unguarded');
  assert.match(!narrow.ok ? narrow.why : '', /skills/);
  assert.equal(ownerHoldsChanges({ merge: { mode: 'owner' } }, has).ok, true, 'no paths: all');
  const repo = { merge: { mode: 'owner', owner_paths: ['**', '!work/**'] } };
  assert.equal(ownerHoldsChanges(repo, has).ok, true);
  assert.deepEqual(
    touchingOwnerPaths([
      { id: 'W-1', touches: ['src/calc.js'] },
      { id: 'W-2', touches: ['skills/execute/SKILL.md', 'src/x.js'] },
    ]),
    [{ item: 'W-2', touches: ['skills/execute/SKILL.md'] }],
  );
});

test("only the owner's yes, in this run, through the rights flow, opens a scope", () => {
  /** @param {Record<string, any>} o */
  const derive = (o) =>
    deriveScope({
      decision: decision(o.decision),
      id: 'W-9',
      events: o.events ?? [answered(o.answered)],
      run: RUN,
      now: NOW,
      issuedAt: o.issuedAt ?? ISSUED,
    });
  const ok = derive({});
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.scope.items, ['W-1', 'W-2']);
  assert.equal(ok.ok && ok.scope.granted_at, iso(NOW - HOUR), 'granted when the owner said yes');

  const no = `B. No: nothing starts under a scope; W-1 and W-2 wait`;
  const noCode = derive({ decision: { answer: no }, answered: { text: no } });
  assert.equal(!noCode.ok && noCode.code, 'scope-not-confirmed', 'a no that names the IDs');
  assert.match(!noCode.ok ? noCode.why : '', /W-1, W-2/, 'the refusal names the items');
  // Not asked with the question run scope question wrote, or asked only after the answer.
  const unasked = derive({ issuedAt: () => null });
  assert.equal(!unasked.ok && unasked.code, 'scope-not-confirmed');
  const late = derive({ issuedAt: () => iso(NOW) });
  assert.equal(!late.ok && late.code, 'scope-not-confirmed');
  // The owner's end in the ledger holds, whatever the store file says.
  const endedEvent = { event: 'scope-ended', decision: 'W-9', by: 'cos', at: iso(NOW - 60_000) };
  const ended = derive({ events: [answered(), endedEvent] });
  assert.equal(!ended.ok && ended.code, 'scope-ended');
  const frontMatterOnly = derive({ events: [] });
  assert.equal(!frontMatterOnly.ok && frontMatterOnly.code, 'not-answered');
  const stale = derive({ answered: { run: 'R-0', at: iso(NOW - 5 * HOUR) } });
  assert.equal(!stale.ok && stale.code, 'scope-ended', 'answered in an earlier run');
  const notScope = derive({ decision: { title: 'Start W-1 and W-2?' } });
  assert.equal(!notScope.ok && notScope.code, 'scope-not-confirmed');
  const long = { ...SPEC, until: iso(NOW + 200 * HOUR) };
  const longYes = `A. ${SCOPE_YES}: ${scopeQuestion(long, []).options[0].what_happens}`;
  const standing = derive({
    decision: { title: scopeTitle(long), answer: longYes },
    answered: { text: longYes },
  });
  assert.equal(!standing.ok && standing.code, 'scope-invalid', 'more than 168 hours');
  const future = derive({ answered: { at: iso(NOW + 60_000) } });
  assert.equal(!future.ok && future.code, 'scope-invalid', 'a yes dated after now');
});

test('a title rewritten after the yes refuses the scope, naming what differs', () => {
  /** @param {Record<string, any>} spec */
  const rewritten = (spec) =>
    deriveScope({
      decision: decision({ title: scopeTitle({ ...SPEC, ...spec }) }),
      id: 'W-9',
      events: [answered()],
      run: RUN,
      now: NOW,
      issuedAt: ISSUED,
    });
  const added = rewritten({ items: ['W-1', 'W-2', 'W-3'] });
  assert.equal(!added.ok && added.code, 'scope-changed');
  assert.match(!added.ok ? added.why : '', /items added: W-3/);
  const raised = rewritten({ budget_tokens: 900_000 });
  assert.match(!raised.ok ? raised.why : '', /budget 100000 became 900000 tokens/);
  const moved = rewritten({ until: iso(NOW + 3 * HOUR) });
  assert.match(!moved.ok ? moved.why : '', /end time .* became/);
  assert.equal(!moved.ok && moved.code, 'scope-changed');
});

test('a scoped start on a device holding an earlier run’s state is charged to the run the ledger shows', () => {
  const store = memoryStore();
  startRun(store, { session: 'cos', host: 'device-b' });
  // Another device starts a later run; this device's ledger learns it from the store, its state does not.
  appendEvent(store, {
    id: 'run-started-later',
    event: 'run-started',
    run: 'R-later',
    session: 'orch-2',
    host: 'device-a',
  });
  const disk = /** @type {any} */ (loadState(store).state);
  assert.notEqual(disk.run.id, 'R-later', 'the disk holds the earlier run');
  const run = new Run(store, { session: 'cos', host: 'device-b', scoped: true }, disk);
  const { event } = run.record({
    event: 'dispatched',
    dispatch: 'D-9',
    item: 'W-1',
    decision: 'W-9',
  });
  assert.equal(event.run, 'R-later');
  const scope = { ...SPEC, run: 'R-later', decision: 'W-9', granted_at: iso(NOW) };
  assert.deepEqual(spentOf(scope, readLedger(store).events).starts, ['D-9']);
});

test('a follow-up of a start under the scope is charged to it', () => {
  const scope = { ...SPEC, run: 'R-1', decision: 'W-9', granted_at: iso(NOW - HOUR) };
  const events = /** @type {any[]} */ ([
    {
      event: 'dispatched',
      run: 'R-1',
      dispatch: 'D-1',
      item: 'W-1',
      decision: 'W-9',
      estimate_tokens: 40_000,
    },
    {
      event: 'reported',
      run: 'R-1',
      dispatch: 'D-1',
      item: 'W-1',
      result: 'partial',
      tokens: 30_000,
    },
    { event: 'dispatched', run: 'R-1', dispatch: 'D-2', item: 'W-1', notes: 'follow-up of D-1' },
    { event: 'reported', run: 'R-1', dispatch: 'D-2', item: 'W-1', result: 'done', tokens: 20_000 },
    { event: 'dispatched', run: 'R-1', dispatch: 'D-3', item: 'W-1', notes: 'follow-up of D-2' },
  ]);
  assert.deepEqual(spentOf(scope, events), { spent: 50_000, starts: ['D-1', 'D-2', 'D-3'] });
});

test('a start inside the scope passes; outside it, expired, ended, edited or past the budget it is refused', () => {
  assert.deepEqual((({ ok, spent, left }) => ({ ok, spent, left }))(/** @type {any} */ (start())), {
    ok: true,
    spent: 0,
    left: 100_000,
  });
  const code = (/** @type {any} */ r) => !r.ok && r.code;
  assert.equal(code(start({ start: { item: 'W-3' } })), 'outside-scope');
  assert.equal(code(start({ start: { decision: 'W-8' } })), 'outside-scope');
  assert.equal(code(start({ start: { now: NOW + 2 * HOUR } })), 'scope-expired');
  assert.equal(
    code(start({ file: { ...FILE, ended: { at: iso(NOW), by: 'cos', reason: 'stop' } } })),
    'scope-ended',
  );
  assert.equal(code(start({ start: { run: { id: 'R-2' } } })), 'scope-ended');
  assert.equal(code(start({ file: null })), 'no-scope');

  // The file grants nothing: items, a budget or an end time written into it are not read, a time
  // to come is refused, and a decision without the owner's yes opens nothing.
  const edited = /** @type {any} */ ({
    ...FILE,
    items: ['W-3'],
    budget_tokens: 1e9,
    until: iso(NOW + 1e9),
  });
  assert.equal(code(start({ file: edited, start: { item: 'W-3' } })), 'outside-scope');
  assert.equal(code(start({ file: { ...FILE, set_at: iso(NOW + HOUR) } })), 'scope-invalid');
  assert.equal(code(start({ decision: { answered_by: 'chief-of-staff' } })), 'not-answered');

  // Spent: a start in flight counts at its estimate, a reported one at its tokens.
  const events = /** @type {any[]} */ ([
    {
      event: 'dispatched',
      run: 'R-1',
      dispatch: 'D-1',
      item: 'W-1',
      decision: 'W-9',
      estimate_tokens: 40_000,
    },
    {
      event: 'dispatched',
      run: 'R-1',
      dispatch: 'D-2',
      item: 'W-2',
      decision: 'W-9',
      estimate_tokens: 40_000,
    },
    { event: 'reported', run: 'R-1', dispatch: 'D-1', item: 'W-1', result: 'done', tokens: 55_000 },
    { event: 'dispatched', run: 'R-1', dispatch: 'D-3', item: 'W-2', estimate_tokens: 40_000 },
  ]);
  const scope = { ...SPEC, run: 'R-1', decision: 'W-9', granted_at: iso(NOW - HOUR) };
  assert.deepEqual(spentOf(scope, events), { spent: 95_000, starts: ['D-1', 'D-2'] });
  assert.equal(code(start({ events, start: { item: 'W-2' } })), 'scope-budget');
});

// --- The commands ---------------------------------------------------------------------------

const ORCH1 = { env: { HITLD_SESSION: 'orch-1' } };
const ORCH2 = { env: { HITLD_SESSION: 'orch-2' } };
const COS = { env: { HITLD_SESSION: 'cos' } };
const tier3 = (/** @type {string} */ id, /** @type {string} */ file) =>
  item({
    id,
    title: `redesign ${id}`,
    kind: 'work',
    state: 'planned',
    tier_override: '3',
    touches: [file],
  });

/** The project the scope's decision items are filed under. */
const PROJECT = {
  'work/initiatives/W-16-run.md': item(
    { id: 'W-16', title: 'Run', kind: 'initiative', state: 'planned', owner: 'owner' },
    '\n## Goal\n\n',
  ),
  'work/projects/W-17-run-work.md': item(
    {
      id: 'W-17',
      title: 'Run work',
      kind: 'project',
      state: 'planned',
      initiative: 'W-16',
      owner: 'owner',
    },
    '\n## Summary\n\n',
  ),
};

/**
 * A consumer in owner merge mode with a run started by orch-1.
 * @param {{ policy?: Record<string, unknown>, files?: Record<string, string>, started?: boolean }} [o]
 */
async function consumer(o = {}) {
  const c = makeConsumer({
    policy: {
      merge: { mode: 'owner', full_suite: ['node --test "test/*.test.js"'] },
      ...(o.policy ?? {}),
    },
    files: { ...PROJECT, ...(o.files ?? {}) },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  if (o.started !== false) {
    const started = await c.hitld(['run', 'start', '--harness-ref', 'cloud-orch-1'], ORCH1);
    assert.equal(started.exit, 0, JSON.stringify(started.result));
  }
  const store = openStore(privateStorePath('orch-fixture', { env: c.env, repoRoot: c.root }));
  return { c, store };
}

/**
 * The chief of staff asks the owner, records the owner's answer and, on a yes, sets the scope.
 * @param {ReturnType<typeof makeConsumer>} c
 * @param {{ items?: string, budget?: number, untilMs?: number, answer?: string, set?: boolean }} [o]
 */
async function ask(c, o = {}) {
  const question = await c.hitld(
    [
      'run',
      'scope',
      'question',
      '--items',
      o.items ?? 'W-1,W-2',
      '--budget-tokens',
      String(o.budget ?? 2_000_000),
      '--until',
      iso(Date.now() + (o.untilMs ?? 4 * HOUR)),
      '--parent',
      'W-17',
    ],
    COS,
  );
  assert.equal(question.exit, 0, JSON.stringify(question.result));
  const recorded = await c.hitld(
    [
      'rights',
      'record',
      '--question',
      // The fixture's tracker is public; the question as printed is otherwise recorded unchanged.
      JSON.stringify({ ...question.result.question, classification: 'public' }),
      '--answer',
      o.answer ?? 'A',
      '--via',
      'question-tool',
      '--shown-at',
      iso(Date.now() - 1000),
    ],
    COS,
  );
  assert.equal(recorded.exit, 0, JSON.stringify(recorded.result));
  const id = String(recorded.result.decision ?? recorded.result.id);
  const set =
    o.set === false ? null : await c.hitld(['run', 'scope', 'set', '--decision', id], COS);
  return { id, question, set };
}

test('commands: the owner says yes; the chief of staff starts inside the scope without the lease, and nothing outside it', async () => {
  const { c, store } = await consumer();
  const { id, set } = await ask(c);
  assert.equal(set?.exit, 0, JSON.stringify(set?.result));
  assert.deepEqual(set?.result.scope.items, ['W-1', 'W-2']);

  const inside = await c.hitld(['dispatch', 'start', 'W-1', '--scope', id], COS);
  assert.equal(inside.exit, 0, JSON.stringify(inside.result));
  assert.equal(inside.result.scope.decision, id);
  const d1 = inside.result.dispatch;
  const handled = await c.hitld(
    ['dispatch', 'handle', '--dispatch', d1, '--harness-ref', 'agent-1', '--scope', id],
    COS,
  );
  assert.equal(handled.exit, 0, JSON.stringify(handled.result));
  const dispatched = readLedger(store).events.find(
    (e) => e.event === 'dispatched' && e.dispatch === d1,
  );
  assert.equal(dispatched?.decision, id);
  assert.equal(dispatched?.by, 'cos');

  // The orchestrator holding the lease sees it in flight and handles its completion.
  const again = await c.hitld(['dispatch', 'start', 'W-1'], ORCH1);
  assert.equal(again.result.error, 'not-planned', 'W-1 is in flight');
  const note = join(c.base, 'report.txt');
  writeFileSync(
    note,
    report({
      item: 'W-1',
      sha: git(c.root, 'rev-parse', 'HEAD'),
      branch: inside.result.branch,
      result: 'blocked',
    }),
  );
  const done = await c.hitld(
    ['dispatch', 'complete', '--dispatch', d1, '--report-file', note, '--tokens', '1000'],
    ORCH1,
  );
  assert.equal(done.exit, 0, JSON.stringify(done.result));

  const before = readLedger(store).events.length;
  assert.equal(
    (await c.hitld(['dispatch', 'start', 'W-3', '--scope', id], COS)).result.error,
    'outside-scope',
  );
  assert.equal(
    (await c.hitld(['dispatch', 'start', 'W-2', '--scope', 'W-1'], COS)).result.error,
    'outside-scope',
  );
  assert.equal((await c.hitld(['dispatch', 'start', 'W-2'], COS)).result.error, 'lease-lost');
  assert.equal(readLedger(store).events.length, before, 'nothing recorded');

  // A scope file edited by hand grants nothing.
  const file = /** @type {any} */ (readScopeFile(store));
  writeScopeFile(store, {
    ...file,
    items: ['W-3'],
    budget_tokens: 1e12,
    until: '2099-01-01T00:00:00.000Z',
  });
  assert.equal(
    (await c.hitld(['dispatch', 'start', 'W-3', '--scope', id], COS)).result.error,
    'outside-scope',
  );
  writeScopeFile(store, { ...file, set_at: '2099-01-01T00:00:00.000Z' });
  assert.equal(
    (await c.hitld(['dispatch', 'start', 'W-2', '--scope', id], COS)).result.error,
    'scope-invalid',
  );
  writeScopeFile(store, file);

  // The decision's title rewritten after the yes (a branch may change tracker files) opens nothing
  // more: adding an item, raising the budget or moving the end each refuses the start.
  const decisionFile = join(
    c.root,
    'work/items',
    /** @type {string} */ (
      readdirSync(join(c.root, 'work/items')).find((n) => n.startsWith(`${id}-`))
    ),
  );
  const asAnswered = readFileSync(decisionFile, 'utf8');
  const agreed = /** @type {any} */ (parseScopeTitle(/^title: "?(.*?)"?$/m.exec(asAnswered)?.[1]));
  for (const change of [
    { items: [...agreed.items, 'W-3'] },
    { budget_tokens: agreed.budget_tokens * 10 },
    { until: iso(Date.parse(agreed.until) + HOUR) },
  ]) {
    writeFileSync(
      decisionFile,
      asAnswered.replace(
        /^title: .*$/m,
        `title: ${JSON.stringify(scopeTitle({ ...agreed, ...change }))}`,
      ),
    );
    const refused = await c.hitld(['dispatch', 'start', 'W-2', '--scope', id], COS);
    assert.equal(refused.result.error, 'scope-changed', JSON.stringify(change));
  }
  writeFileSync(decisionFile, asAnswered);

  // The owner's word ends it, in the ledger: setting it again, or removing the store file and
  // setting it again, does not open it.
  const ended = await c.hitld(['run', 'scope', 'end', '--reason', 'enough for today'], COS);
  assert.equal(ended.exit, 0, JSON.stringify(ended.result));
  assert.equal(ended.result.event.event, 'scope-ended');
  assert.equal(
    (await c.hitld(['dispatch', 'start', 'W-2', '--scope', id], COS)).result.error,
    'scope-ended',
  );
  const reopened = await c.hitld(['run', 'scope', 'set', '--decision', id], COS);
  assert.equal(reopened.result.error, 'scope-ended', JSON.stringify(reopened.result));
  rmSync(join(store.root, 'run/scope.json'));
  const fresh = await c.hitld(['run', 'scope', 'set', '--decision', id], COS);
  assert.equal(fresh.result.error, 'scope-ended', JSON.stringify(fresh.result));
});

test('commands: a no, a stale decision, queue merge mode and a decision that is not the scope question open nothing', async () => {
  // Answered before this run started: the answer belongs to no run.
  const { c } = await consumer({ started: false });
  const stale = await ask(c, { set: false });
  assert.equal((await c.hitld(['run', 'start', '--harness-ref', 'cloud-orch-1'], ORCH1)).exit, 0);
  const staleSet = await c.hitld(['run', 'scope', 'set', '--decision', stale.id], COS);
  assert.equal(staleSet.result.error, 'scope-ended', JSON.stringify(staleSet.result));

  const no = await ask(c, { answer: 'B' });
  assert.equal(no.set?.result.error, 'scope-not-confirmed', JSON.stringify(no.set?.result));
  assert.equal(
    (await c.hitld(['dispatch', 'start', 'W-1', '--scope', no.id], COS)).result.error,
    'no-scope',
  );
  const notScope = await c.hitld(['run', 'scope', 'set', '--decision', 'W-1'], COS);
  assert.equal(notScope.result.error, 'not-found');

  // A scope-titled question recorded by hand, never written by run scope question, opens nothing.
  const spec = { items: ['W-1'], budget_tokens: 1000, until: iso(Date.now() + HOUR) };
  const forged = await c.hitld(
    [
      'rights',
      'record',
      '--question',
      JSON.stringify({ ...scopeQuestion(spec, []), parent: 'W-17', classification: 'public' }),
      '--answer',
      'A',
      '--via',
      'question-tool',
      '--shown-at',
      iso(Date.now() - 1000),
    ],
    COS,
  );
  assert.equal(forged.exit, 0, JSON.stringify(forged.result));
  const forgedId = String(forged.result.decision ?? forged.result.id);
  const forgedSet = await c.hitld(['run', 'scope', 'set', '--decision', forgedId], COS);
  assert.equal(forgedSet.result.error, 'scope-not-confirmed', JSON.stringify(forgedSet.result));

  // An end time without its offset is refused: it would be read in this machine's zone.
  const local = await c.hitld(
    [
      'run',
      'scope',
      'question',
      '--items',
      'W-1',
      '--budget-tokens',
      '1000',
      '--until',
      '2026-11-25T18:00:00',
    ],
    COS,
  );
  assert.equal(local.result.error, 'usage');

  const queue = makeConsumer();
  const refused = await queue.hitld(
    [
      'run',
      'scope',
      'question',
      '--items',
      'W-1',
      '--budget-tokens',
      '1000',
      '--until',
      iso(Date.now() + HOUR),
    ],
    COS,
  );
  assert.equal(refused.result.error, 'scope-merge-unguarded');
  const executor = await c.hitld(['run', 'scope', 'set', '--decision', no.id], {
    env: { HITLD_SESSION: 'x', HITLD_ROLE: 'executor', HITLD_DISPATCH: 'D-1' },
  });
  assert.equal(executor.result.error, 'not-permitted');
});

test('commands: the question lists the named items whose touches reach guard, policy, rights or skill paths', async () => {
  const { c } = await consumer({
    files: {
      'work/items/W-5-skill.md': item({
        id: 'W-5',
        title: 'skill',
        kind: 'work',
        state: 'planned',
        touches: ['skills/execute/SKILL.md'],
      }),
    },
  });
  const { question, set } = await ask(c, { items: 'W-1,W-5' });
  assert.deepEqual(question.result.touching_owner_paths, [
    { item: 'W-5', touches: ['skills/execute/SKILL.md'] },
  ]);
  assert.match(question.result.question.question, /W-5 \(skills\/execute\/SKILL\.md\)/);
  assert.deepEqual(set?.result.touching_owner_paths, question.result.touching_owner_paths);
});

test('commands: an expired scope and an exhausted budget start nothing', async () => {
  const { c, store } = await consumer();
  const small = await ask(c, { budget: 10 });
  assert.equal(small.set?.exit, 0, JSON.stringify(small.set?.result));
  assert.equal(
    (await c.hitld(['dispatch', 'start', 'W-1', '--scope', small.id], COS)).result.error,
    'scope-budget',
  );

  const brief = await ask(c, { untilMs: 1500 });
  assert.equal(brief.set?.exit, 0, JSON.stringify(brief.set?.result));
  await new Promise((r) => setTimeout(r, 1600));
  const expired = await c.hitld(['dispatch', 'start', 'W-1', '--scope', brief.id], COS);
  assert.equal(expired.result.error, 'scope-expired', JSON.stringify(expired.result));
  assert.equal((await c.hitld(['run', 'scope', 'show'], COS)).result.status.active, false);
  assert.equal(readLedger(store).events.filter((e) => e.event === 'dispatched').length, 0);
});

test('commands: across a hand-over the chief of staff starts the scope with no typed start line, and the successor completes it', async () => {
  const { c } = await consumer();
  const { id } = await ask(c);
  assert.equal((await c.hitld(['handover'], ORCH1)).exit, 0);
  const started = await c.hitld(['dispatch', 'start', 'W-2', '--scope', id], COS);
  assert.equal(started.exit, 0, JSON.stringify(started.result));
  const d = started.result.dispatch;
  assert.match(started.result.then, /relay its report/i);
  const resumed = await c.hitld(
    ['run', 'resume', '--live', d, '--harness-ref', 'cloud-orch-2'],
    ORCH2,
  );
  assert.equal(resumed.exit, 0, JSON.stringify(resumed.result));
  assert.deepEqual(resumed.result.adopted, [d]);
  const note = join(c.base, 'report.txt');
  writeFileSync(
    note,
    report({
      item: 'W-2',
      sha: git(c.root, 'rev-parse', 'HEAD'),
      branch: started.result.branch,
      result: 'blocked',
    }),
  );
  const done = await c.hitld(
    ['dispatch', 'complete', '--dispatch', d, '--report-file', note, '--tokens', '1000'],
    ORCH2,
  );
  assert.equal(done.exit, 0, JSON.stringify(done.result));
});

test('commands: a session started under the scope reports to the lease holder; two starts racing for the last slot take it once', async () => {
  const { c, store } = await consumer({
    policy: { execution: { max_executors: { value: 1 } } },
    files: {
      'work/items/W-4-redesign.md': tier3('W-4', 'src/four.js'),
      'work/items/W-6-redesign.md': tier3('W-6', 'src/six.js'),
    },
  });
  const { id } = await ask(c, { items: 'W-4,W-6' });
  // The chief of staff's start and the orchestrator's, at once, for a cap of one.
  const [a, b] = await Promise.all([
    c.hitld(['dispatch', 'start', 'W-4', '--mode', 'interactive', '--scope', id], COS),
    c.hitld(['dispatch', 'start', 'W-6', '--mode', 'interactive'], ORCH1),
  ]);
  const ok = [a, b].filter((r) => r.exit === 0);
  assert.equal(ok.length, 1, JSON.stringify([a.result, b.result]));
  assert.equal([a, b].find((r) => r.exit !== 0)?.result.error, 'not-planned');
  assert.equal(readLedger(store).events.filter((e) => e.event === 'dispatched').length, 1);
  if (a.exit === 0) {
    assert.equal(a.result.instruction.tool, 'session');
    assert.equal(a.result.scope.report_to, 'cloud-orch-1');
    assert.match(readFileSync(a.result.brief_file, 'utf8'), /cloud-orch-1/);
  }
});

// --- Two sessions, two stores ---------------------------------------------------------------

test('two stores: the orchestrator sees the chief of staff’s scoped start, starts no duplicate, and completes it', async () => {
  const dir = tempDir('hitld-scope-two-');
  const project = buildConsumer(join(dir, 'project'), {
    policy: {
      merge: { mode: 'owner', full_suite: ['node --test "test/*.test.js"'] },
      store: { remote: { required: true } },
    },
    files: PROJECT,
  });
  const origin = join(dir, 'origin.git');
  fixtureGit(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  fixtureGit(project, 'remote', 'add', 'origin', origin);
  fixtureGit(project, 'push', '-q', 'origin', 'main');
  const host = join(dir, 'host', 'store.git');
  fixtureGit(dir, 'init', '-q', '--bare', host);
  const deviceA = generateIdentity();
  const deviceB = generateIdentity();

  /** One session on a device of its own: its own data directory, so its own private store. */
  const session = (/** @type {string} */ name, /** @type {{ identity: string }} */ device) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = {
      PATH: process.env.PATH,
      HOME: join(dir, 'home', name),
      XDG_DATA_HOME: join(dir, 'data', name),
      XDG_CONFIG_HOME: join(dir, 'config', name),
      HITLD_STORE_REMOTE: `file://${host}`,
      HITLD_STORE_IDENTITY: device.identity,
      HITLD_SESSION: name,
    };
    writeSetupDone(env);
    recordStatusLine(STATUS_INPUT(project), { cwd: project, env });
    const store = openStore(privateStorePath('orch-fixture', { env, repoRoot: project }));
    /** @param {string[]} argv */
    const hitld = async (argv) => {
      let out = '';
      const exit = await main(argv, { out: (t) => (out += t), err: () => {}, cwd: project, env });
      return { exit, result: /** @type {Record<string, any>} */ (JSON.parse(out)) };
    };
    return { store, hitld };
  };
  const orch = session('orch-1', deviceA);
  approve(orch.store, ['device-a', deviceA], ['device-b', deviceB]);
  const started = await orch.hitld(['run', 'start', '--harness-ref', 'cloud-orch-1']);
  assert.equal(started.exit, 0, JSON.stringify(started.result));
  assert.equal((await orch.hitld(['run', 'checkpoint'])).exit, 0);

  // The chief of staff, on another device: its store learns the run from the remote.
  const cos = session('cos', deviceB);
  const plan = await cos.hitld(['dispatch', 'plan']);
  assert.equal(plan.exit, 0, JSON.stringify(plan.result));
  assert.notEqual(cos.store.root, orch.store.root, 'two stores');
  const question = await cos.hitld([
    'run',
    'scope',
    'question',
    '--items',
    'W-1,W-2',
    '--budget-tokens',
    '2000000',
    '--until',
    iso(Date.now() + 4 * HOUR),
    '--parent',
    'W-17',
  ]);
  assert.equal(question.exit, 0, JSON.stringify(question.result));
  const recorded = await cos.hitld([
    'rights',
    'record',
    '--question',
    JSON.stringify({ ...question.result.question, classification: 'public' }),
    '--answer',
    'A',
    '--via',
    'question-tool',
    '--shown-at',
    iso(Date.now() - 1000),
  ]);
  assert.equal(recorded.exit, 0, JSON.stringify(recorded.result));
  const id = String(recorded.result.decision ?? recorded.result.id);
  const set = await cos.hitld(['run', 'scope', 'set', '--decision', id]);
  assert.equal(set.exit, 0, JSON.stringify(set.result));
  const scoped = await cos.hitld(['dispatch', 'start', 'W-1', '--scope', id]);
  assert.equal(scoped.exit, 0, JSON.stringify(scoped.result));
  assert.equal(scoped.result.store_sync?.push?.status, 'done', 'the start is pushed');
  const d = scoped.result.dispatch;
  assert.equal(
    readLedger(orch.store).events.some((e) => e.dispatch === d),
    false,
    'not yet in the orchestrator’s store',
  );

  // The orchestrator pulls before it starts: W-1 is in flight, and no second executor starts.
  const duplicate = await orch.hitld(['dispatch', 'start', 'W-1']);
  assert.equal(duplicate.result.error, 'not-planned', JSON.stringify(duplicate.result));
  assert.equal(
    readLedger(orch.store).events.some((e) => e.dispatch === d),
    true,
  );
  const note = join(dir, 'report.txt');
  writeFileSync(
    note,
    report({
      item: 'W-1',
      sha: git(project, 'rev-parse', 'HEAD'),
      branch: scoped.result.branch,
      result: 'blocked',
    }),
  );
  const done = await orch.hitld([
    'dispatch',
    'complete',
    '--dispatch',
    d,
    '--report-file',
    note,
    '--tokens',
    '1000',
  ]);
  assert.equal(done.exit, 0, JSON.stringify(done.result));
});
