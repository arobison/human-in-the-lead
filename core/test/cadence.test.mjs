// Event-driven cadences (HITLD-89): what is due and why, from the ledger, the trust record, the
// owner's presence, the machine's state and the clock; never from a calendar except as a ceiling on
// silence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { appendEvent } from '../lib/ledger/ledger.mjs';
import { recordTrustEvent } from '../lib/rights/trust.mjs';
import { EXIT, main } from '../lib/cli/main.mjs';
import { COMMANDS, findCommand } from '../lib/cli/table.mjs';
import { inputSchema } from '../lib/cli/args.mjs';
import { countChanges, dueJobs, eventsSince, outcomesByPerson } from '../lib/cadence/due.mjs';
import {
  idleThreshold,
  machineLoadPerCore,
  parseGpuBusy,
  parsePriorityCpu,
  readIdle,
  sampleLoad,
} from '../lib/cadence/idle.mjs';
import {
  noiseVerdict,
  quietTestStatus,
  readNoiseResult,
  runNoiseTest,
  writeNoiseResult,
} from '../lib/machine/noise.mjs';
import { markJobDone, readCadenceState } from '../lib/cadence/state.mjs';
import { makeProject } from './helpers/project.mjs';
import { tempDir } from './helpers/tmp.mjs';

const T0 = Date.parse('2026-11-14T12:00:00Z');
const HOUR = 3_600_000;
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

/**
 * The policy, with the stale-item sweep off unless `over` sets it, so the tests of the other jobs
 * see only those; the sweep's own test turns it on.
 * @param {Record<string, any>} [over] the policy sections to change
 */
const policyWith = (over = {}) => {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'cadence-test', key: 'W' },
    sweep: { every_merges: 0 },
    ...over,
  });
  assert.deepEqual(errors, []);
  return /** @type {Record<string, any>} */ (policy);
};

let n = 0;
/** @param {string} event @param {Record<string, any>} [over] @param {number} [at] */
const ev = (event, over = {}, at = T0) => ({
  schema_version: 2,
  id: `E-${++n}`,
  event,
  at: iso(at),
  ...over,
});
/** @param {number} k @param {number} [at] merged events */
const merges = (k, at = T0) =>
  Array.from({ length: k }, (_, i) => ev('merged', { item: `W-${i + 1}` }, at));

const busy = {
  idle: false,
  load_per_core: 2,
  idle_below: 0.25,
  live_executors: 1,
  reasons: ['1 executor running on this machine'],
};
const quietMachine = {
  idle: true,
  load_per_core: 0.05,
  idle_below: 0.25,
  live_executors: 0,
  reasons: [],
};

/** @param {Record<string, any>} over */
const context = (over) => ({
  policy: policyWith(),
  events: /** @type {any[]} */ ([]),
  trust: /** @type {any[]} */ ([]),
  state: { schema_version: 1, jobs: {} },
  idle: busy,
  ownerPresent: false,
  now: T0 + HOUR,
  quiet: null,
  ...over,
});

/** @param {ReturnType<typeof dueJobs>} r @param {string} job */
const entryOf = (r, job) => r.due.find((d) => d.job === job);

test('the policy keys say what they measure, with defaults and descriptions', () => {
  const p = policyWith();
  assert.equal(p.reports.every_merges, 10);
  assert.equal(p.reports.silence_max_hours, 168);
  assert.equal(p.digests.silence_max_hours, 48);
  assert.equal(p.baselines.every_merges, 1);
  assert.equal(p.eval.every_merges, 1);
  assert.equal(p.review.every_outcomes, 10);
  const defaults = resolvePolicy({ schema_version: 1, project: { id: 'cadence-test', key: 'W' } });
  assert.equal(defaults.policy?.sweep.every_merges, 1);
  assert.equal(defaults.policy?.sweep.proposed_max_age, 0);
  for (const section of ['reports', 'digests', 'baselines', 'review', 'sweep']) {
    const s = schemas().get(`policy/${section}`);
    for (const [key, sub] of Object.entries(/** @type {Record<string, any>} */ (s.properties))) {
      assert.ok(sub.description, `${section}.${key} has a description`);
      assert.notEqual(sub.default, undefined, `${section}.${key} has a default`);
    }
  }
  // No calendar key: every key but the ceiling counts something that changed.
  const keys = Object.keys(schemas().get('policy/reports').properties ?? {});
  assert.deepEqual(
    keys.filter((k) => /hours|days|cron|every_day|nightly/.test(k)),
    ['silence_max_hours'],
  );
});

test('a quiet ledger has nothing due and nothing waiting to be reported', () => {
  const r = dueJobs(context({}));
  assert.deepEqual(r.due, []);
  assert.deepEqual(r.held, []);
  assert.equal(r.ceiling_at, null);
});

test('a digest is due once enough merges or decisions accumulate, and says why', () => {
  const few = dueJobs(context({ events: merges(4) }));
  assert.equal(entryOf(few, 'digest'), undefined);
  const enough = dueJobs(context({ events: merges(5) }));
  const digest = entryOf(enough, 'digest');
  assert.equal(digest?.trigger, 'threshold');
  assert.match(digest?.why[0] ?? '', /5 merges since the last digest \(threshold 5\)/);
  assert.deepEqual(digest?.run, ['hitld rights digest', 'hitld ledger summary']);
  assert.match(
    digest?.then.at(-1) ?? '',
    /^hitld cadence done digest --through E-\d+ --trust-through 0$/,
  );

  // A decision asked and then answered is one decision; a logged call is one more.
  const decisions = [
    ev('asked', { decision: 'W-9' }),
    ev('answered', { decision: 'W-9' }),
    ev('asked', { decision: 'W-10' }),
    ev('logged', { text: 'picked the in-plan approach' }),
    ev('logged', { text: 'ordered two items' }),
  ];
  assert.equal(countChanges(decisions, decisions).decisions, 4);
  assert.equal(entryOf(dueJobs(context({ events: decisions })), 'digest'), undefined);
  const more = [...decisions, ev('asked', { decision: 'W-11' })];
  assert.equal(entryOf(dueJobs(context({ events: more })), 'digest')?.trigger, 'threshold');
});

test('a report is due on merged value as well as merges, measured by the estimate it was dispatched at', () => {
  const events = [
    ev('dispatched', { dispatch: 'D-1', item: 'W-1', estimate_tokens: 300000 }),
    ev('dispatched', { dispatch: 'D-2', item: 'W-2', estimate_tokens: 250000 }),
    ev('merged', { item: 'W-1', dispatch: 'D-1' }),
    ev('merged', { item: 'W-2' }),
  ];
  const c = countChanges(events, events);
  assert.equal(c.merges, 2);
  assert.equal(c.merged_estimate_tokens, 550000);
  const r = dueJobs(context({ events }));
  assert.equal(entryOf(r, 'report')?.trigger, 'threshold');
  assert.match(entryOf(r, 'report')?.why[0] ?? '', /550000 estimate tokens merged/);
  // A threshold of 0 is off.
  const off = dueJobs(
    context({ events, policy: policyWith({ reports: { every_merged_estimate_tokens: 0 } }) }),
  );
  assert.equal(entryOf(off, 'report'), undefined);
});

test('a correction is not a new event', () => {
  const m = ev('merged', { item: 'W-1' });
  const fix = ev('merged', { item: 'W-1', corrects: m.id });
  assert.equal(countChanges([m, fix], [m, fix]).merges, 1);
});

test('the owner writing makes a digest and a report due when there is something to say', () => {
  const events = merges(1);
  const without = dueJobs(context({ events }));
  assert.deepEqual(without.due, []);
  const present = dueJobs(context({ events, ownerPresent: true }));
  assert.deepEqual(present.due.map((d) => d.job).sort(), ['digest', 'report']);
  assert.equal(entryOf(present, 'digest')?.trigger, 'owner');
  // Nothing new: the owner's presence alone makes nothing due.
  assert.deepEqual(dueJobs(context({ ownerPresent: true })).due, []);
  // min_changes raises the bar.
  const picky = dueJobs(
    context({
      events,
      ownerPresent: true,
      policy: policyWith({ digests: { min_changes: 2 }, reports: { when_owner_writes: false } }),
    }),
  );
  assert.deepEqual(picky.due, []);
});

test('an idle machine makes a digest and a report due, and a busy one does not', () => {
  const events = merges(1);
  assert.deepEqual(
    dueJobs(context({ events, idle: busy })).due.map((d) => d.job),
    [],
  );
  const idle = dueJobs(context({ events, idle: quietMachine }));
  assert.deepEqual(
    idle.due.map((d) => d.job),
    ['digest', 'report', 'baseline', 'eval'],
  );
  assert.equal(entryOf(idle, 'digest')?.trigger, 'idle');
  const off = dueJobs(
    context({ events, idle: quietMachine, policy: policyWith({ digests: { when_idle: false } }) }),
  );
  assert.equal(entryOf(off, 'digest'), undefined);
});

test('the silence ceiling is a ceiling, not a schedule', () => {
  const lease = ev('run-started', { run: 'R-1', session: 's', host: 'h' }, T0);
  const policy = policyWith();
  // A run is active and 49 hours passed: the digest ceiling (48) is reached, the report's (168) is not.
  const at49 = dueJobs(context({ policy, events: [lease], now: T0 + 49 * HOUR }));
  assert.equal(entryOf(at49, 'digest')?.trigger, 'silence');
  assert.equal(entryOf(at49, 'report'), undefined);
  assert.equal(at49.ceiling_at, iso(T0 + 48 * HOUR));
  // No run and nothing changed: silence is allowed to be silence.
  const over = dueJobs(
    context({
      policy,
      events: [
        lease,
        ev('lease-released', { run: 'R-1', session: 's', host: 'h', reason: 'handover', by: 's' }),
      ],
      now: T0 + 400 * HOUR,
    }),
  );
  assert.deepEqual(over.due, []);
  // A digest sent for another reason restarts the ceiling.
  const state = {
    schema_version: 1,
    jobs: { digest: { at: iso(T0 + 40 * HOUR), through: lease.id } },
  };
  const restarted = dueJobs(context({ policy, events: [lease], state, now: T0 + 49 * HOUR }));
  assert.equal(entryOf(restarted, 'digest'), undefined);
  // A report at 169 hours.
  const week = dueJobs(context({ policy, events: [lease], now: T0 + 169 * HOUR }));
  assert.equal(entryOf(week, 'report')?.trigger, 'silence');
});

test('quiet hours hold a digest unless the owner is there to read it', () => {
  const events = merges(5);
  const quiet = { active: true, until: iso(T0 + 8 * HOUR) };
  const held = dueJobs(context({ events, quiet }));
  assert.equal(entryOf(held, 'digest'), undefined);
  const digest = held.held.find((h) => h.job === 'digest');
  assert.equal(digest?.hold_until, iso(T0 + 8 * HOUR));
  const owner = dueJobs(context({ events, quiet, ownerPresent: true }));
  assert.ok(entryOf(owner, 'digest'));
  assert.deepEqual(owner.held, []);
});

test('baselines and evals need a moved branch and an idle machine', () => {
  const none = dueJobs(context({ idle: quietMachine }));
  assert.deepEqual(none.due, []);
  assert.match(none.waiting.find((w) => w.job === 'baseline')?.waiting_for ?? '', /1 more merge/);
  const busyNow = dueJobs(context({ events: merges(1), idle: busy }));
  assert.equal(entryOf(busyNow, 'baseline'), undefined);
  assert.match(
    busyNow.waiting.find((w) => w.job === 'eval')?.waiting_for ?? '',
    /an idle machine: 1 executor running/,
  );
  const ready = dueJobs(context({ events: merges(1), idle: quietMachine }));
  assert.deepEqual(entryOf(ready, 'eval')?.run, ['hitld eval --offline']);
  assert.match(entryOf(ready, 'baseline')?.note ?? '', /quiet-machine hold/);
  // Raising the threshold waits for more merges.
  const raised = dueJobs(
    context({
      events: merges(2),
      idle: quietMachine,
      policy: policyWith({ baselines: { every_merges: 3 } }),
    }),
  );
  assert.equal(entryOf(raised, 'baseline'), undefined);
  assert.ok(entryOf(raised, 'eval'));
});

test('a mark counts only what is newer', () => {
  const first = merges(6);
  const [after] = [ev('merged', { item: 'W-99' })];
  const events = [...first, after];
  const state = {
    schema_version: 1,
    jobs: { digest: { at: iso(T0), through: first.at(-1)?.id ?? null } },
  };
  assert.equal(eventsSince(events, state.jobs.digest).length, 1);
  assert.equal(entryOf(dueJobs(context({ events, state })), 'digest'), undefined);
  // The event a mark names may be gone: fall back to the mark's time.
  const lost = { at: iso(T0 - HOUR), through: 'E-gone' };
  assert.equal(eventsSince(events, lost).length, events.length);
  const later = { at: iso(T0 + HOUR), through: 'E-gone' };
  assert.equal(eventsSince(events, later).length, 0);
  // A mark made on an empty ledger sees everything as new.
  assert.equal(eventsSince(events, { at: iso(T0 + HOUR), through: null }).length, events.length);
});

test('a calibration review is due on new outcomes, per person, with fewer for a first review', () => {
  /** @param {string} kind @param {string} [decider] */
  const t = (kind, decider = '') => ({ kind, at: iso(T0), ...(decider ? { decider } : {}) });
  const outcomes = (/** @type {number} */ k, /** @type {string} */ who = '') =>
    Array.from({ length: k }, () => t('reversal', who));
  // Answers and applications are not outcomes.
  const noise = [t('answered'), t('asked'), t('application')];
  const four = dueJobs(context({ trust: [...noise, ...outcomes(4)] }));
  assert.equal(four.due.length, 0);
  assert.match(four.waiting.find((w) => w.job === 'review')?.waiting_for ?? '', /1 more outcome/);
  const five = dueJobs(context({ trust: [...noise, ...outcomes(5)] }));
  const review = entryOf(five, 'review');
  assert.equal(review?.person, 'owner');
  assert.equal(review?.trigger, 'evidence');
  assert.match(review?.why[0] ?? '', /5 new outcomes of owner's calls, and no review yet/);
  assert.equal(review?.then[0], 'hitld cadence done review --person owner --trust-through 8');

  // Each person has their own count and their own mark.
  const trust = [...outcomes(5, 'C-3'), ...outcomes(2)];
  const counts = outcomesByPerson(trust, { schema_version: 1, jobs: {} });
  assert.deepEqual(
    [...counts],
    [
      ['C-3', 5],
      ['owner', 2],
    ],
  );
  const state = { schema_version: 1, jobs: { 'review:C-3': { at: iso(T0), trust_through: 5 } } };
  const later = dueJobs(context({ trust: [...trust, ...outcomes(9, 'C-3')], state }));
  assert.equal(entryOf(later, 'review'), undefined, '9 new is below the ongoing threshold of 10');
  const tenth = dueJobs(context({ trust: [...trust, ...outcomes(10, 'C-3')], state }));
  assert.equal(entryOf(tenth, 'review')?.person, 'C-3');
});

test('a review is held in quiet hours: it is a read against the attention budget', () => {
  const trust = Array.from({ length: 5 }, () => ({ kind: 'overrule', at: iso(T0) }));
  const r = dueJobs(context({ trust, quiet: { active: true, until: iso(T0 + HOUR) } }));
  assert.equal(r.due.length, 0);
  assert.equal(r.held[0]?.job, 'review');
});

test('Windows has no load average: the load per core is the busy share of a CPU sample', () => {
  // os.loadavg() is always zero on Windows; the sample reads on the same scale, 0 to 1 per core.
  const load = machineLoadPerCore('win32');
  assert.ok(load >= 0 && load <= 1, String(load));
});

test('the machine is idle only with no executor running and low load', () => {
  assert.equal(readIdle({ machineRoot: '/none', loadPerCore: 0.1, liveCount: 0 }).idle, true);
  const loaded = readIdle({ machineRoot: '/none', loadPerCore: 0.6, liveCount: 0 });
  assert.equal(loaded.idle, false);
  assert.match(loaded.reasons[0], /not below the idle threshold 0.25/);
  const running = readIdle({ machineRoot: '/none', loadPerCore: 0, liveCount: 2 });
  assert.equal(running.idle, false);
  assert.match(running.reasons[0], /2 executors running/);
  // The machine file sets the threshold, never above its heavy-work limit.
  assert.equal(idleThreshold({ load: { idle_per_core: 0.4 } }), 0.4);
  assert.equal(idleThreshold({ load: { idle_per_core: 0.4, max_per_core: 0.3 } }), 0.3);
  assert.equal(idleThreshold(null), 0.25);
  assert.equal(
    readIdle({
      machineRoot: '/none',
      loadPerCore: 0.3,
      liveCount: 0,
      machine: { load: { idle_per_core: 0.4 } },
    }).idle,
    true,
  );
});

/** A macOS sample: `ps -A -o pri=,%cpu=` and ioreg's IOAccelerator text, on 8 cores. */
function macSample({ ps = '', gpu = '' } = {}, loadPerCore = 0.47) {
  return sampleLoad({
    platform: 'darwin',
    cores: 8,
    loadPerCore,
    run: (file) => (file === 'ps' ? ps : file === 'ioreg' ? gpu : null),
  });
}

test('high load average from background-priority work alone: idle once the filter is on', () => {
  // The report's sample: about 1 core of background work (priority 4) and 0.8 of everything else
  // on 8 cores; the load average reads 0.47 per core against a 0.3 bar.
  const ps = ['  4  60.0', '  4  40.0', ' 31  50.0', ' 46  30.0', ' 20   0.0', ''].join('\n');
  const gpu = '| | "PerformanceStatistics" = {"Device Utilization %"=0,"Renderer Utilization %"=0}';
  const sample = macSample({ ps, gpu });
  assert.equal(sample.background_per_core, 1 / 8);
  assert.equal(sample.foreground_per_core, 0.8 / 8);
  const machine = { load: { idle_per_core: 0.3 } };
  // Off by default: every priority counts, as before.
  const off = readIdle({ machineRoot: '/none', liveCount: 0, sample, machine });
  assert.equal(off.idle, false);
  assert.equal(off.ignore_background, false);
  assert.match(off.reasons[0], /load 0.47 per core is not below the idle threshold 0.3/);
  const on = readIdle({
    machineRoot: '/none',
    liveCount: 0,
    sample,
    machine: { load: { idle_per_core: 0.3, ignore_background: true } },
  });
  assert.equal(on.idle, true, on.reasons.join('; '));
  assert.equal(on.competing_per_core, 0.1);
  assert.equal(on.background_per_core, 0.13);
  assert.equal(on.load_per_core, 0.47);
  // Competing work over the bar still holds it, and the figure never reads above the load average.
  const busy = macSample({ ps: ' 31 400.0\n  4 100.0\n' }, 0.4);
  const held = readIdle({
    machineRoot: '/none',
    liveCount: 0,
    sample: busy,
    machine: { load: { ignore_background: true } },
  });
  assert.equal(held.idle, false);
  assert.equal(held.competing_per_core, 0.4);
  assert.match(held.reasons[0], /competing load 0.4 per core \(background priority left out\)/);
});

test('an idle CPU and a busy GPU: not idle, the GPU against its own bar', () => {
  const gpu = [
    '+-o AGXAcceleratorG13X  <class AGXAcceleratorG13X>',
    '    "PerformanceStatistics" = {"In use system memory"=123,"Device Utilization %"=62,"Tiler Utilization %"=40}',
  ].join('\n');
  const sample = macSample({ ps: ' 31   2.0\n', gpu }, 0.02);
  assert.equal(sample.gpu_busy, 0.62);
  const r = readIdle({ machineRoot: '/none', liveCount: 0, sample });
  assert.equal(r.idle, false);
  assert.deepEqual(r.reasons, ['GPU busy 0.62 is not below the GPU idle threshold 0.25']);
  assert.equal(r.gpu_idle_below, 0.25);
  // The machine file sets the GPU bar; the report's 18% passes the default.
  assert.equal(
    readIdle({
      machineRoot: '/none',
      liveCount: 0,
      sample,
      machine: { load: { idle_gpu_busy: 0.7 } },
    }).idle,
    true,
  );
  assert.equal(parseGpuBusy('"Device Utilization %"=18'), 0.18);
  // Unreadable: nothing is guessed, and only macOS is read.
  assert.equal(parseGpuBusy(null), null);
  assert.equal(parsePriorityCpu('garbage'), null);
  const linux = sampleLoad({ platform: 'linux', loadPerCore: 0.1, run: () => assert.fail('read') });
  assert.deepEqual(linux, { load_per_core: 0.1 });
  const unreadable = macSample({}, 0.1);
  assert.deepEqual(unreadable, { load_per_core: 0.1 });
  assert.equal(
    readIdle({
      machineRoot: '/none',
      liveCount: 0,
      sample: unreadable,
      machine: { load: { ignore_background: true } },
    }).competing_per_core,
    undefined,
  );
});

test('the noise test speaks only with background work running, and env status shows it with the setting', () => {
  const quietLoad = { load_per_core: 0.4, background_per_core: 0.12, foreground_per_core: 0.05 };
  const close = [100, 101, 99, 100, 102, 100, 98, 101, 100, 100];
  assert.equal(noiseVerdict(close, quietLoad).verdict, 'quiet');
  const wide = [100, 140, 90, 100, 160, 100, 95, 130, 100, 100];
  assert.equal(noiseVerdict(wide, quietLoad).verdict, 'noisy');
  assert.equal(
    noiseVerdict(close, { load_per_core: 0.1, background_per_core: 0 }).verdict,
    'inconclusive',
  );
  assert.equal(noiseVerdict(close, { load_per_core: 0.1 }).verdict, 'unknown');
  // The run: warm-ups, then the timed runs on the clock given, the load sampled around them.
  let t = 0;
  const result = runNoiseTest({
    runs: 5,
    clock: () => (t += 50),
    unit: () => {},
    sample: () => quietLoad,
    now: () => new Date(T0),
  });
  assert.equal(result.runs, 5);
  assert.equal(result.median_ms, 50);
  assert.equal(result.verdict, 'quiet');
  const dir = tempDir('hitld-noise-');
  // env status: the setting says what it does, and is flagged until a noise test backs it.
  const off = quietTestStatus(null, dir);
  assert.equal(off.quiet_test.ignore_background, false);
  assert.match(off.quiet_test.says, /off/);
  assert.equal(off.quiet_test.noise_test, null);
  assert.deepEqual(off.warnings, []);
  const machine = { load: { ignore_background: true } };
  const unbacked = quietTestStatus(machine, dir);
  assert.match(unbacked.quiet_test.says, /on in the machine file/);
  assert.match(unbacked.warnings[0], /no noise test backs it/);
  writeNoiseResult(dir, result);
  assert.equal(readNoiseResult(dir)?.verdict, 'quiet');
  const backed = quietTestStatus(machine, dir);
  assert.equal(backed.quiet_test.noise_test.verdict, 'quiet');
  assert.deepEqual(backed.warnings, []);
  writeNoiseResult(dir, { ...result, verdict: 'noisy', why: 'spread' });
  assert.match(quietTestStatus(machine, dir).warnings[0], /reported noisy/);
});

test('the cadence state round-trips through the private store and refuses a damaged file', () => {
  const project = makeProject();
  assert.deepEqual(readCadenceState(project.store).jobs, {});
  markJobDone(project.store, 'digest', { at: iso(T0), through: 'E-3', trust_through: 2 });
  assert.equal(readCadenceState(project.store).jobs.digest.through, 'E-3');
  project.store.write('cadence/state.json', '{not json');
  assert.throws(() => readCadenceState(project.store), /not JSON/);
  project.store.write(
    'cadence/state.json',
    JSON.stringify({ schema_version: 1, jobs: { digest: {} } }),
  );
  assert.throws(() => readCadenceState(project.store), /invalid/);
});

/** A project whose ledger and trust record the command reads, and a runner for the command line. */
function cli() {
  const project = makeProject();
  const config = tempDir('hitld-cadence-config-');
  // Quiet hours are read in the person's time zone, which defaults to the machine's: fix it, so
  // what is due at 10:00 UTC does not depend on where the tests run.
  mkdirSync(join(config, 'human-in-the-lead'));
  writeFileSync(
    join(config, 'human-in-the-lead', 'person.json'),
    JSON.stringify({ schema_version: 2, attention: { timezone: 'UTC' } }),
    { mode: 0o600 },
  );
  const env = { ...project.env, XDG_CONFIG_HOME: config };
  /** @param {string[]} argv @param {NodeJS.ProcessEnv} [over] */
  const hitld = async (argv, over = env) => {
    let out = '';
    const code = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: project.root,
      env: over,
    });
    return { code, result: /** @type {Record<string, any>} */ (JSON.parse(out)) };
  };
  return { project, hitld, env };
}

test('the stale-item sweep is due after merges, on a busy machine and in quiet hours, and says what it runs', () => {
  const on = policyWith({ sweep: { every_merges: 2 } });
  const one = dueJobs(context({ events: merges(1), policy: on }));
  assert.equal(entryOf(one, 'sweep'), undefined);
  assert.match(one.waiting.find((w) => w.job === 'sweep')?.waiting_for ?? '', /1 more merge/);
  const quiet = { active: true, until: iso(T0 + 8 * HOUR) };
  const two = dueJobs(context({ events: merges(2), policy: on, idle: busy, quiet }));
  const entry = entryOf(two, 'sweep');
  assert.equal(entry?.trigger, 'threshold');
  assert.deepEqual(entry?.why, ['2 merges since the last sweep (threshold 2)']);
  assert.deepEqual(entry?.run, ['hitld work sweep']);
  assert.match(entry?.then[0] ?? '', /orchestrator.*curator/);
  assert.equal(
    entry?.then.at(-1),
    'hitld cadence done sweep --through E-' + n + ' --trust-through 0',
  );
  // Marked done through the last merge: nothing new to sweep.
  const events = merges(2);
  const marked = dueJobs(
    context({
      events,
      policy: on,
      state: { schema_version: 1, jobs: { sweep: { at: iso(T0), through: events[1].id } } },
    }),
  );
  assert.equal(entryOf(marked, 'sweep'), undefined);
  // 0 is off.
  const off = dueJobs(context({ events: merges(5) }));
  assert.equal(entryOf(off, 'sweep'), undefined);
  assert.match(off.waiting.find((w) => w.job === 'sweep')?.waiting_for ?? '', /0 \(off\)/);
});

test('hitld cadence is in the command table, built, with MCP input schemas', () => {
  for (const name of ['cadence due', 'cadence done']) {
    const found = findCommand(name.split(' '));
    assert.ok(found?.command.run, `${name} is built`);
    assert.equal(inputSchema(found.command.args ?? []).type, 'object');
  }
  assert.equal(COMMANDS.filter((c) => c.name.startsWith('cadence')).length, 2);
});

test('hitld cadence due reads the ledger and says what is due; cadence done clears it', async () => {
  const { project, hitld } = cli();
  const now = iso(T0 + HOUR);
  const empty = await hitld(['cadence', 'due', '--now', now, '--load', '2']);
  assert.equal(empty.code, EXIT.ok);
  assert.deepEqual(empty.result.due, []);
  assert.equal(empty.result.next, 'nothing is due');

  for (let i = 1; i <= 5; i++) {
    appendEvent(project.store, { event: 'merged', item: `W-${i}`, id: `merged-W-${i}` });
  }
  const due = await hitld(['cadence', 'due', '--now', now, '--load', '2']);
  assert.deepEqual(
    due.result.due.map((/** @type {any} */ d) => d.job),
    ['digest', 'sweep'],
  );
  assert.equal(due.result.due[0].trigger, 'threshold');
  assert.equal(due.result.idle.idle, false);
  assert.equal(
    due.result.due[0].then.at(-1),
    'hitld cadence done digest --through merged-W-5 --trust-through 0',
  );

  // Reading changes nothing.
  assert.deepEqual(
    (await hitld(['cadence', 'due', '--now', now, '--load', '2'])).result.due,
    due.result.due,
  );

  const done = await hitld(['cadence', 'done', 'digest', '--through', 'merged-W-5', '--now', now]);
  assert.equal(done.code, EXIT.ok);
  assert.equal(done.result.mark.through, 'merged-W-5');
  const swept = await hitld(['cadence', 'done', 'sweep', '--through', 'merged-W-5', '--now', now]);
  assert.equal(swept.code, EXIT.ok);
  const after = await hitld(['cadence', 'due', '--now', now, '--load', '2']);
  assert.deepEqual(after.result.due, []);
  // Idle and a moved branch: baselines and evals run, and the owner's presence brings the report.
  const idle = await hitld(['cadence', 'due', '--now', now, '--load', '0', '--owner-present']);
  assert.deepEqual(
    idle.result.due.map((/** @type {any} */ d) => d.job),
    ['report', 'baseline', 'eval'],
  );
  assert.equal(idle.result.owner_present, true);
});

test('hitld cadence due counts the trust record for reviews', async () => {
  const { project, hitld } = cli();
  for (let i = 0; i < 5; i++)
    recordTrustEvent(
      project.store,
      { kind: 'reversal', area: 'api', subject: 'E-1', subject_kind: 'logged-call' },
      iso(T0),
    );
  const r = await hitld(['cadence', 'due', '--now', iso(T0), '--load', '2']);
  assert.equal(r.result.due[0].job, 'review');
  const done = await hitld([
    'cadence',
    'done',
    'review',
    '--person',
    'owner',
    '--trust-through',
    '5',
    '--now',
    iso(T0),
  ]);
  assert.equal(done.code, EXIT.ok);
  assert.deepEqual(
    (await hitld(['cadence', 'due', '--now', iso(T0), '--load', '2'])).result.due,
    [],
  );
});

test('hitld cadence done refuses what it should', async () => {
  const { hitld, env } = cli();
  assert.equal((await hitld(['cadence', 'done', 'nightly'])).code, EXIT.failed);
  const noPerson = await hitld(['cadence', 'done', 'review']);
  assert.match(noPerson.result.message, /pass --person/);
  const wrong = await hitld(['cadence', 'done', 'digest', '--person', 'owner']);
  assert.match(wrong.result.message, /only for a review/);
  const unknown = await hitld(['cadence', 'done', 'digest', '--through', 'E-404']);
  assert.match(unknown.result.message, /not an event in the ledger/);
  const tooMany = await hitld(['cadence', 'done', 'digest', '--trust-through', '9']);
  assert.match(tooMany.result.message, /more than the 0 trust events/);
  const executor = await hitld(['cadence', 'done', 'digest'], { ...env, HITLD_ROLE: 'executor' });
  assert.equal(executor.result.error, 'not-permitted');
  const badLoad = await hitld(['cadence', 'due', '--load', 'lots']);
  assert.equal(badLoad.result.error, 'usage');
});
