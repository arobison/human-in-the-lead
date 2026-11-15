// The flake quarantine (design part 14.7).
//
// The quarantine file, `.human-in-the-lead/quarantine.json`, is in the repository: every
// worktree, machine and CI run sees the same list. It is public in a public repository, so an
// entry holds only the test ID, the environment scope, the expiry and the fix item. The evidence
// for a flake (logs, rerun results, the comparison) stays in the private store, keyed by the test
// ID, in `merge/flakes.jsonl`.
//
// A quarantined test still runs everywhere and its results are still recorded, but a failure of
// it alone does not fail the full suite. The guard (`checkQuarantine`) is a check on the file: an
// entry without an expiry or a fix item is refused, and so is anything else the schema does not
// allow. The merge queue runs it on main's file and refuses any branch that changes the file.
//
// The project's test report (`$HITLD_TEST_REPORT`) is how the queue learns test IDs. Without one,
// the queue still reruns and compares at the level of the whole suite, but cannot quarantine.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { schemas } from '../schema/registry.mjs';

/** Where the quarantine file is, relative to the repository root. */
export const QUARANTINE_PATH = '.human-in-the-lead/quarantine.json';

/** The private-store file holding the evidence and the measures. */
export const FLAKES_KEY = 'merge/flakes.jsonl';

/**
 * @typedef {{ id: string, environments?: string[], expires: string, fix_item: string }} Entry
 * @typedef {{ schema_version: number, tests: Entry[] }} QuarantineFile
 * @typedef {{ id: string, outcome: 'pass' | 'fail' | 'skip', file?: string }} TestResult
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An empty quarantine. @returns {QuarantineFile} */
export const emptyQuarantine = () => ({
  schema_version: /** @type {number} */ (schemas().currentVersion('quarantine')),
  tests: [],
});

/** The last instant of an entry's expiry day, in UTC. @param {string} expires */
export const expiryInstant = (expires) => Date.parse(`${expires}T23:59:59.999Z`);

/** @param {string} date */
const validDate = (date) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(date)) &&
  new Date(Date.parse(date)).toISOString().startsWith(date);

/**
 * The guard: read the quarantine file's text and name everything wrong with it. An entry needs an
 * expiry and a fix item, and nothing the schema does not list; the same test with the same scope
 * may not appear twice.
 * @param {string} text
 * @returns {{ file: QuarantineFile | null, problems: string[] }}
 */
export function checkQuarantine(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { file: null, problems: [`not JSON: ${/** @type {Error} */ (e).message}`] };
  }
  if (!isObject(data)) return { file: null, problems: ['must be a JSON object'] };
  /** @type {string[]} */
  const problems = [];
  if (Array.isArray(data.tests)) {
    data.tests.forEach((/** @type {unknown} */ t, /** @type {number} */ i) => {
      if (!isObject(t)) return;
      const name = typeof t.id === 'string' && t.id ? `"${t.id.slice(0, 80)}"` : `tests[${i}]`;
      if (t.expires === undefined || t.expires === '' || t.expires === null) {
        problems.push(`${name}: no expiry. A quarantine always ends`);
      } else if (typeof t.expires === 'string' && !validDate(t.expires)) {
        problems.push(`${name}: the expiry "${t.expires}" is not a date, YYYY-MM-DD`);
      }
      if (t.fix_item === undefined || t.fix_item === '' || t.fix_item === null) {
        problems.push(`${name}: no fix item. A quarantine names the work item that fixes the test`);
      }
    });
  }
  const errors = schemas().validateEntity('quarantine', data);
  for (const e of errors) {
    // The two problems above already say it better than "is required".
    if (/^tests\[\d+\]\.(expires|fix_item)$/.test(e.path) && e.message === 'is required') continue;
    problems.push(`${e.path}: ${e.message}`);
  }
  if (!problems.length) {
    const seen = new Set();
    for (const t of /** @type {Entry[]} */ (data.tests)) {
      const key = `${t.id}\0${[...(t.environments ?? [])].sort().join(',')}`;
      if (seen.has(key)) problems.push(`"${t.id}" appears twice with the same scope`);
      seen.add(key);
    }
  }
  return problems.length
    ? { file: null, problems }
    : { file: /** @type {QuarantineFile} */ (data), problems: [] };
}

/**
 * The quarantine file as a commit holds it. A commit without one has an empty quarantine.
 * @param {string} repoRoot @param {string} ref a commit or ref
 * @returns {{ file: QuarantineFile | null, problems: string[], present: boolean }}
 */
export function quarantineAt(repoRoot, ref) {
  const r = spawnSync('git', ['show', `${ref}:${QUARANTINE_PATH}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) return { file: emptyQuarantine(), problems: [], present: false };
  return { ...checkQuarantine(r.stdout), present: true };
}

/**
 * The quarantine file in a working tree.
 * @param {string} root
 * @returns {{ file: QuarantineFile | null, problems: string[], present: boolean }}
 */
export function readQuarantine(root) {
  const path = join(root, QUARANTINE_PATH);
  if (!existsSync(path)) return { file: emptyQuarantine(), problems: [], present: false };
  return { ...checkQuarantine(readFileSync(path, 'utf8')), present: true };
}

/** The file's text: stable order, so a diff shows only what changed. @param {QuarantineFile} file */
export function serializeQuarantine(file) {
  const tests = [...file.tests]
    .sort((a, b) => a.id.localeCompare(b.id) || a.expires.localeCompare(b.expires))
    .map((t) => ({
      id: t.id,
      ...(t.environments?.length ? { environments: [...t.environments].sort() } : {}),
      expires: t.expires,
      fix_item: t.fix_item,
    }));
  return `${JSON.stringify({ schema_version: file.schema_version, tests }, null, 2)}\n`;
}

/** @param {string} root @param {QuarantineFile} file */
export function writeQuarantine(root, file) {
  const path = join(root, QUARANTINE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeQuarantine(file));
  return path;
}

/**
 * The environment labels this machine holds: its operating system, as Node names it, and the
 * labels the project declares (policy flake.environments).
 * @param {{ environments?: string[] } | undefined} flake
 */
export const environmentLabels = (flake) => [process.platform, ...(flake?.environments ?? [])];

/** Whether an entry's scope holds in an environment. @param {Entry} e @param {string[]} labels */
const applies = (e, labels) =>
  !e.environments?.length || e.environments.some((x) => labels.includes(x));

/**
 * The entries that lower the gate now: not expired, and holding in this environment.
 * @param {QuarantineFile | null} file @param {Date} now @param {string[]} labels
 * @returns {Entry[]}
 */
export function activeEntries(file, now, labels) {
  return (file?.tests ?? []).filter(
    (e) => expiryInstant(e.expires) >= now.getTime() && applies(e, labels),
  );
}

/**
 * The entries past their expiry: each is a decision for the owner (fix it now, rewrite it, or
 * delete it), and the test gates again.
 * @param {QuarantineFile | null} file @param {Date} now
 * @returns {Entry[]}
 */
export const expiredEntries = (file, now) =>
  (file?.tests ?? []).filter((e) => expiryInstant(e.expires) < now.getTime());

/** The expiry date for an entry made today. @param {Date} now @param {number} days */
export const expiryFrom = (now, days) =>
  new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Add an entry. The guard's rule is applied to the result, so an entry without an expiry or a fix
 * item never reaches the file.
 * @param {QuarantineFile | null} file the current file (null: none yet)
 * @param {Entry} entry
 * @returns {{ file: QuarantineFile } | { problems: string[] }}
 */
export function addEntry(file, entry) {
  const next = {
    ...(file ?? emptyQuarantine()),
    tests: [...(file?.tests ?? []), entry],
  };
  const checked = checkQuarantine(serializeQuarantine(next));
  return checked.file ? { file: checked.file } : { problems: checked.problems };
}

/**
 * The project's test report, written by the full suite to `$HITLD_TEST_REPORT`: a JSON object
 * `{ "schema_version": 1, "tests": [{ "id": "...", "outcome": "pass" | "fail" | "skip",
 * "file": "path of the file that defines it" }] }`. `file` is optional. Anything else is no report.
 * @param {string} text
 * @returns {TestResult[] | null}
 */
export function parseTestReport(text) {
  try {
    const data = JSON.parse(text);
    if (!isObject(data) || data.schema_version !== 1 || !Array.isArray(data.tests)) return null;
    /** @type {TestResult[]} */
    const out = [];
    for (const t of data.tests) {
      if (!isObject(t) || typeof t.id !== 'string' || !t.id) return null;
      if (t.outcome !== 'pass' && t.outcome !== 'fail' && t.outcome !== 'skip') return null;
      out.push({
        id: t.id,
        outcome: t.outcome,
        ...(typeof t.file === 'string' && t.file ? { file: t.file } : {}),
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** @param {string} path @returns {TestResult[] | null} null: no report, or an unreadable one */
export function readTestReport(path) {
  try {
    return existsSync(path) ? parseTestReport(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

/**
 * Write the queue's records to the private store: every full-suite failure of a batch (with what
 * the rerun and the comparison found), every failure a quarantined test was excused from, and
 * the burn-in runs. These are the evidence and the source of the flake measures.
 * @param {import('../store/store.mjs').PrivateStore} store
 * @param {{ failures: import('./queue.mjs').Failure[], excused: import('./queue.mjs').Excused[],
 *   burn_ins: import('./queue.mjs').BurnIn[] }} result
 * @param {() => Date} [now]
 */
export function recordFlakes(store, result, now = () => new Date()) {
  const at = now().toISOString();
  /** @param {Record<string, unknown>} r */
  const put = (r) => store.append(FLAKES_KEY, JSON.stringify({ at, ...r }) + '\n');
  for (const f of result.failures) {
    put({
      kind: 'failure',
      outcome: f.outcome,
      commit: f.commit,
      command: f.command,
      items: f.items,
      tests: f.tests,
      quarantinable: f.quarantinable,
      base: f.base,
      candidate: f.candidate,
      runs: f.runs,
      output: f.output.slice(-1000),
    });
  }
  for (const x of result.excused) put({ kind: 'excused', commit: x.commit, tests: x.tests });
  for (const b of result.burn_ins) {
    put({ kind: 'burn_in', item: b.item, runs: b.runs, ok: b.ok });
  }
}

/** @param {import('../store/store.mjs').PrivateStore} store @returns {Record<string, any>[]} */
export function readFlakes(store) {
  return (store.read(FLAKES_KEY) ?? '')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const r = JSON.parse(line);
        return isObject(r) ? [r] : [];
      } catch {
        return [];
      }
    });
}

/**
 * Record that an entry was made or removed: the start and end of a test's time in quarantine,
 * for the time-to-deflake measure.
 * @param {import('../store/store.mjs').PrivateStore} store
 * @param {{ kind: 'quarantined' | 'removed', test: string, fix_item: string }} r
 * @param {() => Date} [now]
 */
export function recordQuarantineEvent(store, r, now = () => new Date()) {
  store.append(FLAKES_KEY, JSON.stringify({ at: now().toISOString(), ...r }) + '\n');
}

/**
 * Whether the store holds evidence that lets the orchestrator quarantine a test without asking
 * (design 14.7): a recorded fail and then pass on the same commit, and the comparison showing it
 * fails on the base too, with the test not one the branch under test added or changed.
 * @param {Record<string, any>[]} records @param {string} test
 * @returns {Record<string, any> | null} the record
 */
export function quarantineEvidence(records, test) {
  return (
    [...records]
      .reverse()
      .find(
        (r) =>
          r.kind === 'failure' &&
          r.outcome === 'preexisting' &&
          Array.isArray(r.quarantinable) &&
          r.quarantinable.includes(test),
      ) ?? null
  );
}

/** Days from a date to a later one, rounded down. @param {string} from @param {Date} to */
const daysSince = (from, to) =>
  Math.max(0, Math.floor((to.getTime() - Date.parse(from)) / 86_400_000));

/**
 * The flake section of a digest: the quarantine list with each entry's expiry and fix item, its
 * size and oldest entry, what quarantined tests would have caught, and the measures (design 14.7).
 * Test IDs, scopes, expiries and fix items are what the repository holds; counts are derived.
 * @param {{ file: QuarantineFile | null, records: Record<string, any>[], now: Date,
 *   labels: string[], quarantineDays: number }} o
 */
export function flakeDigest(o) {
  const tests = o.file?.tests ?? [];
  const events = o.records.filter((r) => r.kind === 'quarantined');
  /** @param {Entry} e the day it went in: the event, else the expiry less the usual stay */
  const since = (e) => {
    const ev = [...events].reverse().find((r) => r.test === e.id && r.fix_item === e.fix_item);
    return (
      ev?.at ?? new Date(expiryInstant(e.expires) - o.quarantineDays * 86_400_000).toISOString()
    );
  };
  const caught = (/** @type {string} */ id) =>
    o.records.filter((r) => r.kind === 'excused' && Array.isArray(r.tests) && r.tests.includes(id))
      .length;
  const list = tests.map((e) => ({
    test: e.id,
    ...(e.environments?.length ? { environments: e.environments } : {}),
    expires: e.expires,
    fix_item: e.fix_item,
    expired: expiryInstant(e.expires) < o.now.getTime(),
    age_days: daysSince(since(e), o.now),
    failures_excused: caught(e.id),
  }));
  const failures = o.records.filter((r) => r.kind === 'failure');
  const candidates = failures.filter((r) => r.outcome !== 'real');
  const removed = o.records.filter((r) => r.kind === 'removed');
  const deflake = removed.flatMap((r) => {
    const start = events.find((q) => q.test === r.test && Date.parse(q.at) <= Date.parse(r.at));
    return start ? [(Date.parse(r.at) - Date.parse(start.at)) / 86_400_000] : [];
  });
  return {
    size: list.length,
    oldest_days: list.length ? Math.max(...list.map((e) => e.age_days)) : 0,
    quarantined: list,
    expired: list.filter((e) => e.expired).map((e) => e.test),
    measures: {
      failures: failures.length,
      flake_candidates: candidates.length,
      flake_rate: failures.length ? Number((candidates.length / failures.length).toFixed(3)) : null,
      preexisting: candidates.filter((r) => r.outcome === 'preexisting').length,
      introduced: candidates.filter((r) => r.outcome === 'introduced').length,
      inconclusive: candidates.filter((r) => r.outcome === 'inconclusive').length,
      flake_cost_runs: candidates.reduce((n, r) => n + (Number(r.runs) || 0), 0),
      burn_in_runs: o.records
        .filter((r) => r.kind === 'burn_in')
        .reduce((n, r) => n + (Number(r.runs) || 0), 0),
      excused_failures: o.records.filter((r) => r.kind === 'excused').length,
      time_to_deflake_days: deflake.length
        ? Number((deflake.reduce((a, b) => a + b, 0) / deflake.length).toFixed(1))
        : null,
    },
  };
}

/**
 * The decision an expired entry becomes, in the shape `hitld rights ask` takes. Fix it now,
 * rewrite it, or delete it; deleting a test is never the system's call.
 * @param {Entry} e
 */
export function expiredQuestion(e) {
  return {
    title: `Quarantined test ${e.id.slice(0, 60)} has expired`,
    question: `The quarantine of the test "${e.id}" ended on ${e.expires}, and it gates again. Fix it now, rewrite it, or delete it?`,
    context: `Its fix item is ${e.fix_item}. The evidence for the flake is in the private store.`,
    options: [
      {
        label: 'A',
        what_happens: `Fix it now: ${e.fix_item} is the next item to dispatch, and the test gates until it merges`,
        reversible: true,
      },
      {
        label: 'B',
        what_happens: 'Rewrite it: a work item replaces the test with one that is not flaky',
        reversible: true,
      },
      {
        label: 'C',
        what_happens:
          'Delete it: the owner decides, never the system; the coverage it gave is lost',
        reversible: false,
      },
    ],
    recommendation: {
      option: 'A',
      why: 'A flake left alone trains everyone to ignore red; the fix item already holds the evidence.',
    },
    classification: 'public',
  };
}
