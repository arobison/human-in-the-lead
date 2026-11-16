// Eval results (design part 17.5): one JSON document per run in the private store, the baseline
// the regression gate compares with, and the transcripts of what did not pass.
//
// Store keys, under the eval/ prefix:
//   eval/results/<run ID>.json
//   eval/baselines/<mode>-<settings hash>.json     a full run the owner accepted as the baseline
//   eval/transcripts/<run ID>/<scenario>@<profile>.json
//
// The accepted baseline is also written, stripped of anything machine-specific, to
// evals/baselines/<mode>-<settings hash>.json in the primary checkout, for the owner to commit
// (design part 17.9). The gate reads that committed file first and the private store's copy second,
// so CI and a cloud session, which have no private store, gate on the same baseline as a laptop.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hostname, homedir, userInfo } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';
import { canonicalJson } from '../policy/policy.mjs';
import { renameReplacing } from '../platform/fs.mjs';

/**
 * @typedef {import('./runner.mjs').CaseResult} CaseResult
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {Record<string, any>} EvalResult
 */

// Version 2 added the optional grader detail (path, expected, actual) and the baseline's
// `accepted` record. Both are optional, so version 1 runs and baselines still load.
export const RESULT_SCHEMA_VERSION = 3;

/** Scenario suites renamed by HITLD-82 (the letter prefixes went). */
const LEGACY_SUITES = /** @type {Record<string, string>} */ ({
  'd-contract': 'contract',
  'f-quotas': 'quotas',
  'h-orchestrator': 'orchestrator',
});

/**
 * A stored result of schema version 2 or older in the names of version 3 (HITLD-82), read until
 * the next minor release: each scenario's `status` is `result`, `not_applicable` is
 * `not-applicable`, `piece` is `suite`, and a suite named with a letter prefix has lost it, so a
 * baseline from before still compares by scenario. The schema_version stays as written.
 * @param {any} doc
 */
export function fromLegacyResult(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.scenarios)) return doc;
  if (typeof doc.schema_version !== 'number' || doc.schema_version >= 3) return doc;
  const suite = (/** @type {string} */ s) => LEGACY_SUITES[s] ?? s;
  return {
    ...doc,
    scenarios: doc.scenarios.map((/** @type {any} */ c) => {
      const { status, piece, ...rest } = c;
      const [first, ...name] = String(rest.id).split('/');
      return {
        ...rest,
        id: [suite(first), ...name].join('/'),
        suite: suite(String(piece ?? rest.suite ?? first)),
        result: status === 'not_applicable' ? 'not-applicable' : (status ?? rest.result),
      };
    }),
  };
}

/**
 * The hash of what must match for two runs to be comparable.
 * @param {{ mode: string, seed: number, profiles: string[] }} settings @returns {string} twelve hex digits
 */
export function settingsHash({ mode, seed, profiles }) {
  const text = canonicalJson({ mode, seed, profiles: [...profiles].sort() });
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * The commit of a checkout, or null when it is not a git checkout or git is absent.
 * @param {string} dir @returns {string | null}
 */
export function checkoutCommit(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * What the checkout the suite ran in was: its commit, and whether its working tree had changes
 * (tracked or untracked, ignored files left out). Both null when it is not a git checkout. A
 * baseline is accepted only from a clean run of a commit on main (design part 17.9).
 * @param {string} dir @returns {{ commit: string | null, dirty: boolean | null }}
 */
export function checkoutState(dir) {
  const commit = checkoutCommit(dir);
  if (commit === null) return { commit: null, dirty: null };
  try {
    // The committed baselines are what accepting a run writes; they change nothing a run measures.
    const status = execFileSync(
      'git',
      ['-C', dir, 'status', '--porcelain', '--', '.', `:(exclude)${COMMITTED_BASELINES}`],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      },
    );
    return { commit, dirty: status.trim() !== '' };
  } catch {
    return { commit, dirty: null };
  }
}

/**
 * Why a stored run may not become the baseline because of the commit it ran on, or null. A
 * baseline judges main, so the run must be of a commit reachable from the main branch (the local
 * branch, or its upstream remote-tracking ref when it has one) with a clean working tree.
 * @param {EvalResult} run
 * @param {{ root: string, mainBranch: string }} where root: the primary checkout, whose git answers
 * @returns {{ error: 'no-commit' | 'dirty-tree' | 'not-on-main', message: string } | null}
 */
export function provenanceRefusal(run, { root, mainBranch }) {
  const c = run.checkout;
  const on = `run the suite on ${mainBranch} in the primary checkout with a clean tree, then accept that run`;
  if (!c || !c.commit) {
    return {
      error: 'no-commit',
      message: `this run did not record the commit it ran on (a run before this was recorded, or not in a git checkout); ${on}`,
    };
  }
  if (c.dirty !== false) {
    return {
      error: 'dirty-tree',
      message: `this run was made with ${c.dirty ? 'uncommitted changes' : 'a working tree whose state is unknown'}; a baseline judges ${mainBranch}, so ${on}`,
    };
  }
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync('git', ['-C', root, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  const refs = [`refs/heads/${mainBranch}`];
  try {
    const upstream = git(['rev-parse', '--symbolic-full-name', `${mainBranch}@{upstream}`]);
    if (upstream) refs.push(upstream);
  } catch {
    // No upstream is configured: the local branch alone.
  }
  for (const ref of refs) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      git(['merge-base', '--is-ancestor', c.commit, ref]);
      return null;
    } catch {
      // This ref is missing, or does not hold the commit; the next one may.
    }
  }
  return {
    error: 'not-on-main',
    message: `this run's commit ${c.commit.slice(0, 12)} is not on ${mainBranch}; a baseline judges ${mainBranch}, so ${on}`,
  };
}

/** @param {Date} d "20261114T031500Z" */
const compact = (d) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

/**
 * Summarize cases: counts, totals, and each category's mean score over its applicable cases
 * (not-applicable ones are left out, never counted as passes).
 * @param {CaseResult[]} cases
 */
export function summarize(cases) {
  const count = (/** @type {string} */ s) => cases.filter((c) => c.result === s).length;
  /** @type {Record<string, { sum: number, n: number }>} */
  const byCategory = {};
  for (const c of cases) {
    if (c.result === 'not-applicable') continue;
    const slot = (byCategory[c.category] ??= { sum: 0, n: 0 });
    slot.sum += c.score ?? 0;
    slot.n += 1;
  }
  return {
    total: cases.length,
    passed: count('pass'),
    failed: count('fail'),
    errors: count('error'),
    not_applicable: count('not-applicable'),
    tokens: cases.reduce((a, c) => a + (c.tokens ?? 0), 0),
    wall_ms: cases.reduce((a, c) => a + c.wall_ms, 0),
    categories: Object.fromEntries(
      Object.entries(byCategory)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, { score: v.sum / v.n, scenarios: v.n }]),
    ),
  };
}

/**
 * Build the result document for a run. Transcripts are not in it: it holds their store keys.
 * @param {{
 *   cases: CaseResult[], now: Date, version: string, name: string, commit: string | null,
 *   mode: 'offline' | 'live', seed: number, profiles: string[], filter: string | null,
 *   policyHash: string | null, policySource: 'file' | 'defaults', scenarioSetVersion: string,
 *   scenarioCount: number, checkout?: { commit: string | null, dirty: boolean | null },
 * }} run
 * @returns {{ result: EvalResult, transcripts: Map<string, unknown> }} transcripts by store key
 */
export function buildResult(run) {
  const hash = settingsHash(run);
  const id = `EV-${compact(run.now)}-${hash.slice(0, 6)}`;
  /** @type {Map<string, unknown>} */
  const transcripts = new Map();
  const scenarios = run.cases.map((c) => {
    /** @type {string | null} */
    let transcript = null;
    if (c.result !== 'pass' && c.result !== 'not-applicable') {
      transcript = `eval/transcripts/${id}/${c.id.replace('/', '__')}@${c.profile}.json`;
      transcripts.set(transcript, {
        scenario: c.id,
        profile: c.profile,
        result: c.result,
        reason: c.reason ?? null,
        steps: c.transcript,
      });
    }
    return {
      id: c.id,
      suite: c.suite,
      category: c.category,
      profile: c.profile,
      result: c.result,
      score: c.score,
      ...(c.reason ? { reason: c.reason } : {}),
      graders: c.graders,
      wall_ms: c.wall_ms,
      tokens: c.tokens,
      transcript,
    };
  });
  /** @type {EvalResult} */
  const result = {
    schema_version: RESULT_SCHEMA_VERSION,
    id,
    at: run.now.toISOString(),
    mode: run.mode,
    plugin: { name: run.name, version: run.version, commit: run.commit },
    schema_versions: Object.fromEntries(
      schemas()
        .versionedIds()
        .sort()
        .map((s) => [s, /** @type {number} */ (schemas().currentVersion(s))]),
    ),
    harness: { adapter: 'fake', profiles: [...run.profiles].sort() },
    policy_hash: run.policyHash,
    policy_source: run.policySource,
    settings: {
      seed: run.seed,
      profiles: [...run.profiles].sort(),
      scenario_filter: run.filter,
      settings_hash: hash,
    },
    scenario_set: { version: run.scenarioSetVersion, count: run.scenarioCount },
    scenarios,
    summary: summarize(run.cases),
    ...(run.checkout ? { checkout: run.checkout } : {}),
  };
  return { result, transcripts };
}

/**
 * Check a result against its schema, then write it and its transcripts.
 * @param {PrivateStore} store @param {EvalResult} result @param {Map<string, unknown>} transcripts
 * @returns {string} the store key of the result
 */
export function recordResult(store, result, transcripts) {
  const errors = schemas().validateEntity('eval-result', result);
  if (errors.length)
    throw new Error(`the eval result is not valid (a bug in the runner): ${formatErrors(errors)}`);
  for (const [key, doc] of transcripts) store.write(key, `${JSON.stringify(doc, null, 2)}\n`);
  const key = `eval/results/${result.id}.json`;
  store.write(key, `${JSON.stringify(result, null, 2)}\n`);
  return key;
}

/** @param {string} mode @param {string} hash */
export const baselineFile = (mode, hash) => `${mode}-${hash}.json`;

/** @param {string} mode @param {string} hash */
export const baselineKey = (mode, hash) => `eval/baselines/${baselineFile(mode, hash)}`;

/** Where the committed baselines live, relative to a checkout's root. */
export const COMMITTED_BASELINES = 'evals/baselines';

/** @param {string} mode @param {string} hash the committed baseline's path, relative to the root */
export const committedBaselinePath = (mode, hash) =>
  `${COMMITTED_BASELINES}/${baselineFile(mode, hash)}`;

/**
 * Parse and check a stored or committed baseline.
 * @param {string} text @param {string} where for the message
 * @returns {EvalResult}
 */
function parseBaseline(text, where) {
  const doc = fromLegacyResult(JSON.parse(text));
  const errors = schemas().validateEntity('eval-result', doc);
  if (errors.length) {
    throw new Error(`${where} is not a valid eval result: ${formatErrors(errors)}`);
  }
  return doc;
}

/**
 * The baseline in the private store for a run's settings, or null.
 * @param {PrivateStore} store @param {EvalResult} result @returns {EvalResult | null}
 */
export function readBaseline(store, result) {
  const text = store.read(baselineKey(result.mode, result.settings.settings_hash));
  return text === null ? null : parseBaseline(text, 'the stored baseline');
}

/**
 * The baseline committed in a checkout for a run's settings, or null.
 * @param {string} root the checkout's root @param {EvalResult} result @returns {EvalResult | null}
 */
export function readCommittedBaseline(root, result) {
  const hash = result.settings.settings_hash;
  const path = committedBaselinePath(result.mode, hash);
  /** @type {string} */
  let text;
  try {
    text = readFileSync(join(root, path), 'utf8');
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return null;
    throw e;
  }
  const doc = parseBaseline(text, `the committed baseline ${path}`);
  if (doc.settings.settings_hash !== hash || doc.mode !== result.mode) {
    throw new Error(
      `the committed baseline ${path} holds settings ${doc.mode}-${doc.settings.settings_hash}, not ${result.mode}-${hash}`,
    );
  }
  return doc;
}

/**
 * The baseline the gate compares a run with: the one committed in the checkout, else the private
 * store's, and which it was. `committedOnly` ignores the store, for CI and the release, which have
 * none and must not pass on one.
 * @param {{ store: PrivateStore | null, root: string, committedOnly?: boolean }} where
 * @param {EvalResult} result
 * @returns {{ baseline: EvalResult | null, source: 'committed' | 'private-store' | null, path: string }}
 *   path: where a committed baseline for these settings is, relative to the root
 */
export function findBaseline(where, result) {
  const path = committedBaselinePath(result.mode, result.settings.settings_hash);
  const committed = readCommittedBaseline(where.root, result);
  if (committed) return { baseline: committed, source: 'committed', path };
  if (!where.committedOnly && where.store) {
    const stored = readBaseline(where.store, result);
    if (stored) return { baseline: stored, source: 'private-store', path };
  }
  return { baseline: null, source: null, path };
}

/**
 * Why a stored run cannot be accepted as the baseline, or null when it can. The one rule behind
 * `hitld eval accept` and the accept text on the results page.
 * @param {EvalResult} run @param {EvalResult | null} baseline the baseline now stored for the run's settings
 * @returns {string | null}
 */
export function acceptRefusal(run, baseline) {
  if (run.mode !== 'offline') return `${run.mode} runs have no accept command yet`;
  if (run.settings.scenario_filter != null)
    return 'this run covered only some scenarios; a baseline comes from a full run';
  if (run.summary.failed + run.summary.errors > 0)
    return 'this run has failing scenarios; a failing run cannot be a baseline';
  if (!run.gate) return 'no gate verdict was recorded for this run';
  if (!run.gate.ok) return 'this run failed the regression gate';
  if (baseline?.id === run.id) return 'this run is already the baseline';
  // The gate must have judged this run against the baseline stored now: a run judged against an
  // older baseline (or none) could otherwise roll the baseline back.
  if ((run.gate.baseline ?? null) !== (baseline?.id ?? null)) {
    return 'this run was judged against a different baseline than the current one; run the suite again';
  }
  if (baseline && run.at < baseline.at) return 'this run is older than the current baseline';
  return null;
}

/**
 * The baseline document for an accepted run: the run, and who accepted it and when.
 * @param {EvalResult} result @param {Date} now
 * @returns {EvalResult}
 */
function baselineDocument(result, now) {
  // The private store is shared by every checkout on the machine, some running older code that
  // refuses keys it does not know. The stored baseline keeps only keys that code knows: not the
  // run's `checkout` (the commit and tree state it ran on) and not the gate's `baseline_source`.
  const { checkout: _checkout, gate, ...rest } = result;
  const { baseline_source: _source, ...knownGate } = gate ?? {};
  return {
    ...rest,
    ...(gate ? { gate: knownGate } : {}),
    accepted: { by: 'owner', at: now.toISOString(), run: result.id },
  };
}

/**
 * Make a run the baseline for its settings in the private store, and record who accepted it and
 * when. The committed copy is written by acceptBaseline.
 * @param {PrivateStore} store @param {EvalResult} result @param {Date} [now]
 * @returns {string} the store key
 */
export function writeBaseline(store, result, now = new Date()) {
  const key = baselineKey(result.mode, result.settings.settings_hash);
  store.write(key, `${JSON.stringify(baselineDocument(result, now), null, 2)}\n`);
  return key;
}

/** @param {{ id: string, profile: string }} s */
const scenarioKey = (s) => `${s.id}@${s.profile}`;

/**
 * The committed form of a baseline (design part 17.9): what the gate needs and nothing else. Each
 * scenario keeps its ID, suite, category, profile, result, score, tokens and the grader names and
 * verdicts. Left out: the grader messages, expected and actual values (they quote fixture paths),
 * the reasons, the transcript keys (private-store keys), wall time (it varies with the machine),
 * the checkout's commit and tree state (a commit cannot hold its own ID) and the run's gate verdict. Scenarios are
 * sorted, so the same results give the same file on any machine.
 * @param {EvalResult} baseline @returns {EvalResult}
 */
export function committedForm(baseline) {
  const { gate: _gate, checkout: _checkout, ...doc } = fromLegacyResult(baseline);
  const scenarios = [...doc.scenarios]
    .sort((a, b) => (scenarioKey(a) < scenarioKey(b) ? -1 : 1))
    .map((/** @type {any} */ s) => ({
      id: s.id,
      suite: s.suite,
      category: s.category,
      profile: s.profile,
      result: s.result,
      score: s.score,
      graders: s.graders.map((/** @type {any} */ g) => ({
        id: g.id,
        grader: g.grader,
        passed: g.passed,
        message: '',
      })),
      wall_ms: 0,
      tokens: s.tokens,
      transcript: null,
    }));
  return {
    ...doc,
    plugin: { ...doc.plugin, commit: null },
    scenarios,
    summary: { ...doc.summary, wall_ms: 0 },
  };
}

/** What must not be in a committed baseline, and what each pattern finds. */
const MACHINE_SPECIFIC = /** @type {Array<[RegExp, string]>} */ ([
  [/(?:^|[^\w.\-/:])\/[\w.@~+-]+(?:\/[\w.@~+-]*)*/, 'an absolute path'],
  [/\b[A-Za-z]:\\/, 'a Windows path'],
  [/(?:^|\W)~\//, 'a home-directory path'],
  [/file:\/\//, 'a file URL'],
  [/\beval\/(?:results|baselines|transcripts)\//, 'a private-store key'],
  [/\.local\/share|XDG_[A-Z_]+|\.config\//, 'a private-store location'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/, 'an email address or an account at a host'],
  [/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|lan|internal|corp|home|localdomain)\b/i, 'a hostname'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, 'an IP address'],
]);

/** @returns {string} the account name of this process, or '' */
function accountName() {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

/**
 * What in a baseline is machine-specific or confidential: paths, hostnames, account names,
 * addresses and private-store content, found in any string of the document, keys included. The
 * names of this machine (its host, its account, its home directory) are checked too, and so is
 * anything in `extra` (the private store's path, the checkout's). It is the check acceptBaseline
 * makes before it writes, and the test makes it over every baseline in the repository.
 * @param {unknown} doc @param {string[]} [extra] more strings that must not appear
 * @returns {string[]} one line per finding, with where it is; empty when the document is clean
 */
export function machineSpecificProblems(doc, extra = []) {
  const here = [hostname(), accountName(), homedir(), ...extra].filter((t) => t && t.length >= 4);
  /** @type {string[]} */
  const found = [];
  /** @param {unknown} v @param {string} at */
  const walk = (v, at) => {
    if (typeof v === 'string') {
      for (const [re, what] of MACHINE_SPECIFIC) {
        if (re.test(v)) found.push(`${at}: ${what} (${JSON.stringify(v.slice(0, 60))})`);
      }
      for (const t of here) {
        // As a whole word, so an account named "root" does not match "root-cause".
        const word = new RegExp(`(?<![\\w-])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
        if (word.test(v)) found.push(`${at}: a name from this machine (${JSON.stringify(t)})`);
      }
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        walk(k, `${at}.${k} (key)`);
        walk(x, `${at}.${k}`);
      }
    }
  };
  walk(doc, '$');
  return found;
}

/**
 * Make a run the baseline: record it in the private store, and write its committed form to
 * evals/baselines/ in `root`, the primary checkout, for the owner to commit. Nothing is written
 * when the committed form would carry anything machine-specific.
 * @param {{ store: PrivateStore, root: string, result: EvalResult, now?: Date }} a
 * @returns {{ key: string, file: string, accepted: any }}
 *   key: the store key; file: the committed baseline's path
 */
export function acceptBaseline({ store, root, result, now = new Date() }) {
  const doc = baselineDocument(result, now);
  const form = committedForm(doc);
  const errors = schemas().validateEntity('eval-result', form);
  if (errors.length) {
    throw new Error(`the committed baseline is not a valid eval result: ${formatErrors(errors)}`);
  }
  const problems = machineSpecificProblems(form, [store.root, root]);
  if (problems.length) {
    throw new Error(
      `the committed baseline would carry what stays on this machine; nothing was written: ${problems.slice(0, 5).join('; ')}`,
    );
  }
  const key = writeBaseline(store, result, now);
  const file = join(root, committedBaselinePath(result.mode, result.settings.settings_hash));
  mkdirSync(join(root, COMMITTED_BASELINES), { recursive: true });
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, `${JSON.stringify(form, null, 2)}\n`);
  renameReplacing(part, file);
  return { key, file, accepted: doc.accepted };
}
