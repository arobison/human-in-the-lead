// Feedback about HITLd, recorded locally (design part 18.4). A record is one JSON file in the
// consuming project's private store, feedback/FB-<n>.json. It is confidential: it holds the
// person's words and the project's IDs, so it is written only into the private store and never
// into the repository or any worktree. Publishing it is a separate, approved step (publish.mjs).

import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { findRepoRoot } from '../policy/policy.mjs';
import { readLedger } from '../ledger/ledger.mjs';
import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';
import { VERSION } from '../version.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {Record<string, any>} FeedbackRecord see schemas/feedback.schema.json
 */

export const KINDS = Object.freeze(['bug', 'friction', 'idea', 'worked-well']);
export const FEEDBACK_PREFIX = 'feedback/';
const REF = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;
const ID = /^FB-([1-9][0-9]*)$/;

/** The store key of a record. @param {string} id */
export const keyOf = (id) => `${FEEDBACK_PREFIX}${id}.json`;

/**
 * The canonical form of a path that may not exist yet: its deepest existing ancestor with symbolic
 * links resolved, then the rest.
 * @param {string} path
 */
function canonical(path) {
  let head = resolve(path);
  /** @type {string[]} */
  const tail = [];
  while (!existsSync(head) && dirname(head) !== head) {
    tail.unshift(head.slice(dirname(head).length + 1));
    head = dirname(head);
  }
  return join(realpathSync(head), ...tail);
}

/** @param {string} root @param {string} path */
const within = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
};

/**
 * Every checkout of the repository that holds `cwd`: its root and each linked worktree.
 * @param {string} cwd @returns {string[]}
 */
function checkoutsOf(cwd) {
  const root = findRepoRoot(cwd);
  if (!root) return [];
  const found = new Set([canonical(root)]);
  try {
    const listing = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const m of listing.matchAll(/^worktree (.+)$/gm)) found.add(canonical(m[1]));
  } catch {
    // Git cannot list worktrees here: the root found above is all there is to check.
  }
  return [...found];
}

/**
 * Refuse a store that is, or resolves into, the repository or one of its worktrees. Feedback
 * records are confidential: they live only in the private store. Checked on the store directory
 * and again on the record's own path, so a link inside the store cannot lead back into a checkout.
 * @param {PrivateStore} store @param {string} cwd @param {string} [key]
 */
export function assertPrivate(store, cwd, key) {
  const targets = [store.root, ...(key ? [join(store.root, key)] : [])].map(canonical);
  for (const checkout of checkoutsOf(cwd)) {
    for (const t of targets) {
      if (within(checkout, t)) {
        throw new Error(
          `refusing to write feedback into ${t}: it is inside the repository or a worktree (${checkout}). Feedback records are confidential and live only in the private store`,
        );
      }
    }
  }
}

/**
 * Validate a record: the schema, and the rules it cannot express.
 * @param {unknown} record @returns {string[]} problems, empty when valid
 */
export function checkRecord(record) {
  const errors = schemas().validateEntity('feedback', record);
  const problems = errors.length ? [formatErrors(errors)] : [];
  if (problems.length || typeof record !== 'object' || record === null) return problems;
  const r = /** @type {FeedbackRecord} */ (record);
  if (r.state === 'filed' && !r.url) problems.push('a filed record needs the issue url');
  if (r.state !== 'filed' && r.url !== undefined) problems.push('url is only for a filed record');
  if (r.state === 'withheld' && !r.reason) problems.push('a withheld record needs a reason');
  if (r.state !== 'withheld' && r.reason !== undefined)
    problems.push('reason is only for a withheld record');
  if ((r.state === 'drafted' || r.state === 'filed') && !r.draft)
    problems.push(`a ${r.state} record needs its draft`);
  if (r.state === 'filed' && !r.approval)
    problems.push("a filed record needs the person's approval");
  if (
    r.approval &&
    r.state !== 'filed' &&
    !(r.state === 'drafted' && r.approval.mode === 'by-hand')
  )
    problems.push('approval is only for a filed record, or a drafted one approved by-hand');
  return problems;
}

/**
 * Split --refs into IDs. A malformed one is an error that names it, never dropped.
 * @param {string | undefined} text @returns {string[]}
 */
export function parseRefs(text) {
  if (text === undefined || text.trim() === '') return [];
  const refs = text.split(/[\s,]+/).filter(Boolean);
  const bad = refs.filter((r) => !REF.test(r));
  if (bad.length) {
    throw new Error(
      `not an ID: ${bad.map((b) => JSON.stringify(b)).join(', ')}. A ref is a dispatch, decision, item or ledger event ID such as D-3, HITLD-12 or E-40`,
    );
  }
  return [...new Set(refs)];
}

/** The loop each ledger event belongs to, for an area the person did not give. */
const LOOP_OF = Object.freeze({
  dispatched: 'dispatch',
  started: 'dispatch',
  reported: 'dispatch',
  abandoned: 'dispatch',
  unclaimed: 'dispatch',
  asked: 'decision rights',
  answered: 'decision rights',
  verified: 'verification',
  merged: 'merge',
  reverted: 'merge',
  'run-started': 'run continuity',
  'lease-taken': 'run continuity',
});

/** @param {Record<string, any>} e */
const short = (e) =>
  [
    e.id,
    e.event,
    ...['dispatch', 'item', 'decision', 'result', 'branch', 'commit'].map((k) =>
      e[k] === undefined ? null : k === 'result' ? `result=${e[k]}` : e[k],
    ),
  ]
    .filter(Boolean)
    .join(' ');

/**
 * What the ledger says about the refs: the events that name any of them, a short account, the
 * loop they belong to and the refs with no entry. Reads structured fields only, never notes.
 * @param {PrivateStore} store @param {string[]} refs
 */
export function ledgerContext(store, refs) {
  if (!refs.length)
    return { evidence: [], what_happened: undefined, area: undefined, unmatched: [] };
  const { events } = readLedger(store);
  const named = (/** @type {Record<string, any>} */ e) =>
    [e.id, e.dispatch, e.item, e.decision].filter(Boolean);
  const hits = events.filter((e) => named(e).some((x) => refs.includes(x)));
  const unmatched = refs.filter((r) => !hits.some((e) => named(e).includes(r)));
  const loops = [
    ...new Set(
      hits.map((e) => /** @type {Record<string, string>} */ (LOOP_OF)[e.event]).filter(Boolean),
    ),
  ];
  const what_happened = hits.length
    ? `The ledger has ${hits.length} ${hits.length === 1 ? 'entry' : 'entries'} for ${refs.join(', ')}: ${hits.map((e) => e.event).join(', ')}.`
    : undefined;
  return {
    evidence: hits.map(short),
    what_happened,
    area: loops.length ? loops.join(', ') : undefined,
    unmatched,
  };
}

/** The next record ID: one above the highest FB-<n> in the store. @param {PrivateStore} store */
function nextId(store) {
  let max = 0;
  for (const k of store.list(FEEDBACK_PREFIX)) {
    const m = ID.exec(k.slice(FEEDBACK_PREFIX.length).replace(/\.json$/, ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `FB-${max + 1}`;
}

/**
 * Record feedback. Offline: reads the ledger and writes one file.
 * @param {PrivateStore} store
 * @param {{ cwd: string, kind: string, words: string, refs?: string, area?: string, expected?: string,
 *   harness?: string, harnessVersion?: string, defaultHarness: string, now?: () => Date }} o
 */
export function recordFeedback(store, o) {
  if (!KINDS.includes(o.kind)) {
    throw new Error(`--kind must be one of ${KINDS.join(', ')}, not ${JSON.stringify(o.kind)}`);
  }
  if (typeof o.words !== 'string' || o.words.trim() === '') throw new Error('--words is empty');
  const refs = parseRefs(o.refs);
  assertPrivate(store, o.cwd);
  const id = nextId(store);
  assertPrivate(store, o.cwd, keyOf(id));
  const { evidence, what_happened, area, unmatched } = ledgerContext(store, refs);
  const areaOf = o.area || area;
  /** @type {FeedbackRecord} */
  const record = {
    schema_version: 1,
    id,
    kind: o.kind,
    words: o.words,
    created_at: (o.now?.() ?? new Date()).toISOString(),
    version: VERSION,
    // The core cannot learn a harness's version offline; the caller may pass what its session knows.
    harness: { name: o.harness ?? o.defaultHarness, version: o.harnessVersion ?? 'unknown' },
    ...(areaOf ? { area: areaOf } : {}),
    refs,
    ...(what_happened ? { what_happened } : {}),
    ...(o.expected ? { expected: o.expected } : {}),
    ...(evidence.length ? { evidence } : {}),
    state: 'local',
    classification: 'confidential',
  };
  const problems = checkRecord(record);
  if (problems.length) throw new Error(`the record is not valid: ${problems.join('; ')}`);
  // Trust boundary: the private store, outside every checkout (assertPrivate above).
  store.write(keyOf(id), `${JSON.stringify(record, null, 2)}\n`);
  return { record, unmatched };
}

/**
 * Every record in the store. A file that does not parse or validate is reported, not skipped.
 * @param {PrivateStore} store
 * @returns {{ records: FeedbackRecord[], problems: { key: string, message: string }[] }}
 */
export function readRecords(store) {
  /** @type {FeedbackRecord[]} */
  const records = [];
  /** @type {{ key: string, message: string }[]} */
  const problems = [];
  for (const key of store.list(FEEDBACK_PREFIX)) {
    if (!/^feedback\/FB-[1-9][0-9]*\.json$/.test(key)) continue;
    let data;
    try {
      data = JSON.parse(store.read(key) ?? '');
    } catch {
      problems.push({ key, message: 'is not JSON' });
      continue;
    }
    const bad = checkRecord(data);
    if (bad.length) problems.push({ key, message: bad.join('; ') });
    else records.push(data);
  }
  records.sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));
  return { records, problems };
}

/** Records still waiting to be published. @param {FeedbackRecord} r */
export const isWaiting = (r) => r.state === 'local' || r.state === 'drafted';

/**
 * Read one record. @param {PrivateStore} store @param {string} id
 */
export function readRecord(store, id) {
  if (!ID.test(id)) throw new Error(`${JSON.stringify(id)} is not a feedback ID such as FB-3`);
  const text = store.read(keyOf(id));
  if (text === null) throw new Error(`no feedback record ${id} in the private store`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${id} is not JSON`);
  }
  const problems = checkRecord(data);
  if (problems.length) throw new Error(`${id} is not a valid record: ${problems.join('; ')}`);
  return /** @type {FeedbackRecord} */ (data);
}

/**
 * Mark a record dropped. A filed record is already public and cannot be dropped here.
 * @param {PrivateStore} store @param {string} id @param {string} cwd
 */
export function dropRecord(store, id, cwd) {
  assertPrivate(store, cwd, keyOf(id));
  const record = readRecord(store, id);
  if (record.state === 'filed') throw new Error(`${id} is filed; it cannot be dropped`);
  if (record.state === 'dropped')
    return { record: /** @type {FeedbackRecord} */ (record), changed: false };
  /** @type {FeedbackRecord} */
  const next = { ...record, state: 'dropped' };
  delete next.reason;
  // Trust boundary: the private store, outside every checkout (assertPrivate above).
  store.write(keyOf(id), `${JSON.stringify(next, null, 2)}\n`);
  return { record: next, changed: true };
}
