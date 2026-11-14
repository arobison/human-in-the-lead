// The baseline, the triage verdicts and the accepted risks (design part 10.5), in the private
// store under security/. Every file is confidential: a real finding not yet fixed is a
// vulnerability. A public item records only that its scans passed.
//
// A finding is let through when its key (tool, rule, code fingerprint, occurrence) is in the
// baseline, has a by-design or false-positive verdict, or has an accepted risk. A real verdict
// does not let it through: a real finding is fixed, or the owner accepts it. An accepted risk past
// its expiry becomes a decision for the owner again.

import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('./sarif.mjs').Finding} Finding
 * @typedef {'baseline' | 'verdicts' | 'accepted-risks' | 'pending'} Kind
 * @typedef {{ key: string, tool: string, rule: string, path: string, line: number, fingerprint: string,
 *   at: string, message?: string, level?: string, commit?: string, item?: string, branch?: string,
 *   verdict?: 'real' | 'by-design' | 'false-positive', reason?: string, expires?: string,
 *   decision?: string, by?: string }} Entry
 * @typedef {{ baseline: Entry[] | null, tools: { tool: string, version: string }[],
 *   verdicts: Entry[], accepted: Entry[], pending: Entry[] }} Records
 *   baseline is null until the first scan creates it
 */

/** @type {Record<Kind, string>} */
export const SECURITY_KEYS = Object.freeze({
  baseline: 'security/baseline.json',
  verdicts: 'security/verdicts.json',
  'accepted-risks': 'security/accepted-risks.json',
  pending: 'security/pending.json',
});

export const VERDICTS = Object.freeze(['real', 'by-design', 'false-positive']);

/**
 * Read one file. Absent is null; a file that does not validate stops everything, because treating
 * a damaged baseline as empty would let its findings back in as a new baseline.
 * @param {PrivateStore} store @param {Kind} kind
 */
function readFile(store, kind) {
  const text = store.read(SECURITY_KEYS[kind]);
  if (text === null) return null;
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${SECURITY_KEYS[kind]} in the private store is not valid JSON`);
  }
  const errors = schemas().validateEntity('security-records', data);
  if (!errors.length && data.kind !== kind) {
    errors.push({ path: 'kind', message: `must be ${kind}` });
  }
  if (errors.length) {
    throw new Error(`${SECURITY_KEYS[kind]} in the private store: ${formatErrors(errors)}`);
  }
  return data;
}

/** @param {PrivateStore} store @returns {Records} */
export function readRecords(store) {
  const baseline = readFile(store, 'baseline');
  return {
    baseline: baseline ? baseline.entries : null,
    tools: baseline?.tools ?? [],
    verdicts: readFile(store, 'verdicts')?.entries ?? [],
    accepted: readFile(store, 'accepted-risks')?.entries ?? [],
    pending: readFile(store, 'pending')?.entries ?? [],
  };
}

/** @param {PrivateStore} store @param {Kind} kind @param {Entry[]} entries @param {Records['tools']} [tools] */
function writeFile(store, kind, entries, tools) {
  const data = {
    schema_version: 1,
    kind,
    classification: 'confidential',
    ...(kind === 'baseline' ? { tools: tools ?? [] } : {}),
    entries,
  };
  const errors = schemas().validateEntity('security-records', data);
  if (errors.length)
    throw new Error(`refusing to write ${SECURITY_KEYS[kind]}: ${formatErrors(errors)}`);
  store.write(SECURITY_KEYS[kind], JSON.stringify(data, null, 2) + '\n');
}

/** @param {PrivateStore} store @param {Records} r */
export const saveBaseline = (store, r) => writeFile(store, 'baseline', r.baseline ?? [], r.tools);

/** @param {Finding} f @param {string} at @returns {Entry} */
function entryOf(f, at) {
  return {
    key: f.key,
    tool: f.tool,
    rule: f.rule,
    path: f.path,
    line: f.line,
    fingerprint: f.fingerprint,
    ...(f.message ? { message: f.message } : {}),
    ...(f.level ? { level: f.level } : {}),
    at,
  };
}

/**
 * Whether the baseline holds this tool version's first run on main.
 * @param {Records} r @param {{ tool: string, version: string }} t
 */
export const knowsTool = (r, t) =>
  r.baseline !== null && r.tools.some((x) => x.tool === t.tool && x.version === t.version);

/**
 * Extend the baseline with a scan of main, for each tool version it does not hold yet. The first
 * scan creates it. Nothing else adds to it. Changes `r`; the caller saves.
 * @param {Records} r @param {{ tools: { tool: string, version: string }[], findings: Finding[] }} scan
 * @param {{ commit?: string, now?: () => Date }} [options]
 * @returns {{ created: boolean, added: number, tools: string[] }}
 */
export function extendBaseline(r, scan, options = {}) {
  const at = (options.now?.() ?? new Date()).toISOString();
  const created = r.baseline === null;
  const baseline = r.baseline ?? [];
  const fresh = scan.tools.filter((t) => !knowsTool(r, t));
  const have = new Set(baseline.map((e) => e.key));
  let added = 0;
  for (const f of scan.findings) {
    if (!fresh.some((t) => t.tool === f.tool && t.version === f.version) || have.has(f.key))
      continue;
    have.add(f.key);
    baseline.push({ ...entryOf(f, at), ...(options.commit ? { commit: options.commit } : {}) });
    added++;
  }
  r.baseline = baseline;
  r.tools = [...r.tools, ...fresh];
  return { created, added, tools: fresh.map((t) => `${t.tool} ${t.version}`.trim()) };
}

/**
 * After a batch merges: remove the baseline findings of each scanned tool that the scan of the
 * merged code no longer reports. Only a tool version the baseline knows counts, so a new rule set
 * renaming its rules does not empty the baseline. Changes `r`; the caller saves.
 * @param {Records} r @param {{ tools: { tool: string, version: string }[], findings: Finding[] }} scan
 * @returns {string[]} the keys removed
 */
export function removeFixed(r, scan) {
  if (r.baseline === null) return [];
  const tools = new Set(scan.tools.filter((t) => knowsTool(r, t)).map((t) => t.tool));
  const still = new Set(scan.findings.map((f) => f.key));
  const removed = r.baseline
    .filter((e) => tools.has(e.tool) && !still.has(e.key))
    .map((e) => e.key);
  const gone = new Set(removed);
  r.baseline = r.baseline.filter((e) => !gone.has(e.key));
  return removed;
}

/**
 * Sort a scan's findings: new (fail the branch), covered (baseline, verdict or accepted risk), and
 * expired (an accepted risk past its expiry: let through, and a decision for the owner).
 * @param {Finding[]} findings @param {Records} r @param {Date} [now]
 */
export function classify(findings, r, now = new Date()) {
  const baseline = new Set((r.baseline ?? []).map((e) => e.key));
  const passing = new Map(
    r.verdicts.filter((v) => v.verdict !== 'real').map((v) => [v.key, v.verdict]),
  );
  const accepted = new Map(r.accepted.map((a) => [a.key, a]));
  /** @type {(Finding & { recorded_real?: boolean })[]} */
  const fresh = [];
  /** @type {{ key: string, by: string }[]} */
  const covered = [];
  /** @type {Entry[]} */
  const expired = [];
  for (const f of findings) {
    const risk = accepted.get(f.key);
    if (baseline.has(f.key)) covered.push({ key: f.key, by: 'baseline' });
    else if (passing.has(f.key)) covered.push({ key: f.key, by: String(passing.get(f.key)) });
    else if (risk) {
      covered.push({ key: f.key, by: 'accepted-risk' });
      if (isExpired(risk, now)) expired.push(risk);
    } else {
      const real = r.verdicts.some((v) => v.key === f.key && v.verdict === 'real');
      fresh.push(real ? { ...f, recorded_real: true } : f);
    }
  }
  return { new: fresh, covered, expired };
}

/** @param {Entry} risk @param {Date} now */
const isExpired = (risk, now) => Date.parse(String(risk.expires)) <= now.getTime();

/** @param {Records} r @param {Date} [now] @returns {Entry[]} */
export const expiredRisks = (r, now = new Date()) => r.accepted.filter((a) => isExpired(a, now));

/**
 * Keep the new findings a branch was sent back with, so a verdict can be recorded by key.
 * @param {PrivateStore} store @param {Finding[]} findings
 * @param {{ item?: string, branch?: string, now?: () => Date }} [options]
 */
export function recordPending(store, findings, options = {}) {
  if (!findings.length) return;
  const at = (options.now?.() ?? new Date()).toISOString();
  const keys = new Set(findings.map((f) => f.key));
  const kept = (readFile(store, 'pending')?.entries ?? []).filter(
    (/** @type {Entry} */ e) => !keys.has(e.key),
  );
  const item =
    options.item && /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(options.item) ? options.item : undefined;
  for (const f of findings) {
    kept.push({
      ...entryOf(f, at),
      ...(item ? { item } : {}),
      ...(options.branch ? { branch: options.branch } : {}),
    });
  }
  writeFile(store, 'pending', kept);
}

/**
 * The record of a finding by key: pending first, then the baseline and the verdicts.
 * @param {Records} r @param {string} key @returns {Entry | null}
 */
export function findingByKey(r, key) {
  return (
    r.pending.find((e) => e.key === key) ??
    (r.baseline ?? []).find((e) => e.key === key) ??
    r.verdicts.find((e) => e.key === key) ??
    r.accepted.find((e) => e.key === key) ??
    null
  );
}

/** @param {Entry} e @returns {Entry} the finding's own fields */
const findingPart = (e) => ({
  key: e.key,
  tool: e.tool,
  rule: e.rule,
  path: e.path,
  line: e.line,
  fingerprint: e.fingerprint,
  ...(e.message ? { message: e.message } : {}),
  ...(e.level ? { level: e.level } : {}),
  at: e.at,
});

/**
 * Record a triage verdict for a finding the queue reported. The next scan does not ask again at
 * the same place; when the code there changes, its key changes and it is asked again.
 * @param {PrivateStore} store
 * @param {{ key: string, verdict: string, reason: string, item?: string, by?: string, now?: () => Date }} v
 * @returns {Entry}
 */
export function recordVerdict(store, v) {
  if (!VERDICTS.includes(v.verdict)) {
    throw new Error(`the verdict must be one of ${VERDICTS.join(', ')}`);
  }
  if (!v.reason?.trim()) {
    throw new Error(
      'a verdict needs its evidence: the test (real), the trust boundary at the sink (by-design) or a one-line reason (false-positive)',
    );
  }
  const r = readRecords(store);
  const found = findingByKey(r, v.key);
  if (!found)
    throw new Error(`no finding ${v.key} is known: the merge queue reports a finding's key`);
  /** @type {Entry} */
  const entry = {
    ...findingPart(found),
    at: (v.now?.() ?? new Date()).toISOString(),
    verdict: /** @type {Entry['verdict']} */ (v.verdict),
    reason: v.reason.trim(),
    ...(v.item ? { item: v.item } : found.item ? { item: found.item } : {}),
    ...(v.by ? { by: v.by } : {}),
  };
  writeFile(store, 'verdicts', [...r.verdicts.filter((e) => e.key !== v.key), entry]);
  writeFile(
    store,
    'pending',
    r.pending.filter((e) => e.key !== v.key),
  );
  return entry;
}

/**
 * Record the owner's acceptance of a real finding as a risk, until an expiry. The caller has
 * checked that this is the owner's own decision (see the security commands).
 * @param {PrivateStore} store
 * @param {{ key: string, expires: string, reason: string, decision?: string, now?: () => Date }} a
 * @returns {Entry}
 */
export function acceptRisk(store, a) {
  const now = a.now?.() ?? new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.expires) || Number.isNaN(Date.parse(a.expires))) {
    throw new Error('the expiry must be a date, YYYY-MM-DD');
  }
  if (Date.parse(a.expires) <= now.getTime()) throw new Error('the expiry must be in the future');
  if (!a.reason?.trim()) throw new Error("an accepted risk needs the owner's reason");
  const r = readRecords(store);
  const found = findingByKey(r, a.key);
  if (!found)
    throw new Error(`no finding ${a.key} is known: the merge queue reports a finding's key`);
  /** @type {Entry} */
  const entry = {
    ...findingPart(found),
    at: now.toISOString(),
    expires: a.expires,
    reason: a.reason.trim(),
    ...(a.decision ? { decision: a.decision } : {}),
    by: 'owner',
  };
  writeFile(store, 'accepted-risks', [...r.accepted.filter((e) => e.key !== a.key), entry]);
  writeFile(
    store,
    'pending',
    r.pending.filter((e) => e.key !== a.key),
  );
  return entry;
}

/**
 * The question an expired accepted risk becomes: fix it now, or accept it for another period
 * (design 10.5). In the shape `hitld rights ask` takes; confidential, like the risk.
 * @param {Entry} risk
 */
export function expiredRiskQuestion(risk) {
  return {
    title: `Accepted security risk ${risk.key} has expired`,
    question: `The accepted risk for finding ${risk.key} expired on ${risk.expires}. Fix it now, or accept it for another period?`,
    context: `${risk.tool}, rule ${risk.rule}, in ${risk.path} at line ${risk.line}. Accepted because: ${risk.reason ?? 'no reason recorded'}.`,
    options: [
      {
        label: 'A',
        what_happens:
          'Fix it now: a work item in the security loop, with a test that would have caught it',
        reversible: true,
      },
      {
        label: 'B',
        what_happens: `Accept it for another period: hitld security accept --finding ${risk.key} --expires <date>`,
        reversible: true,
      },
    ],
    recommendation: {
      option: 'A',
      why: 'A real finding left open is a vulnerability; accepting it again should have a reason that still holds.',
    },
    classification: 'confidential',
    paths: [risk.path],
    triggers: [
      {
        basis: 'security',
        reason: "accepting a real security finding as a risk is the owner's call (design 10.4)",
      },
    ],
  };
}
