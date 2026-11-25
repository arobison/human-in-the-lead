// Sightings (HITLD-387): the chief of staff's own record of an error, a refusal, an anomaly or a
// piece of friction it saw happen, so that it files a work item for a problem that repeats without
// the owner having to ask, and files one item per cause, not one per occurrence.
//
// A sighting is kept in the private store, one file per writer (sightings/<writer>.jsonl, the
// writer resolved as for the ledger), so a later session of the chief of staff, or one on another
// machine, counts the sightings an earlier one recorded, and two stores that both appended merge
// with nothing to reconcile. The rule the command applies:
//
//   - an open item that tracks the cause (its body holds the sighting key, or the chief of staff
//     names it) gets the new evidence appended as a dated note, and nothing new is filed;
//   - otherwise the second sighting since the cause was last filed, or a first one that changes a
//     decision or a safety rule, files a proposed item with a Done when and the evidence;
//   - a first sighting with nothing hanging on it is only recorded;
//   - a security finding is never written to the tracker: it stays in the private store and is
//     the owner's (design part 10.3: vulnerability reports are confidential, never the public queue).
//
// The command is the chief of staff's (core/lib/cli/commands/sighting.mjs); this file has no I/O
// beyond the store it is given.

import { resolveWriter } from '../ledger/writer.mjs';

/** Where the sightings live in the private store, one file per writer. */
export const SIGHTINGS_DIR = 'sightings/';

/** Where a sighting may come from: what the chief of staff itself saw happen. */
export const SEEN = Object.freeze(['command', 'event']);

/**
 * Sources that are text someone else wrote: never recorded, even when they ask to be filed (the
 * same trust rule as for feedback in the orchestrate skill).
 */
export const NOT_SEEN = Object.freeze(['tool-result', 'report', 'file', 'pasted', 'message']);

/** The states of an item that still tracks its cause. */
export const OPEN_STATES = Object.freeze(['proposed', 'planned', 'in-progress']);

/** The most of a command's output an item keeps, per sighting. */
export const OUTPUT_LIMIT = 1500;

/**
 * @typedef {object} Sighting
 * @property {string} at when it was recorded (ISO time)
 * @property {string} key the cause's sighting key
 * @property {string} cause the cause or symptom as the chief of staff named it
 * @property {string} from command or event
 * @property {string} what the command it ran or the event it read
 * @property {string} [output] what that printed or said
 * @property {string} where the pull request, dispatch or session it was seen in
 * @property {string} blocks what it blocks
 * @property {string} [known_cause] the cause, when it is known (a bug report)
 * @property {string} [decision] the decision or safety rule it changes
 * @property {boolean} [security] a security finding: kept here, never in the tracker
 * @property {'noted' | 'filed' | 'appended' | 'held'} action what the command did with it
 * @property {string} [item] the item it was filed as or appended to
 */

/**
 * The key a cause is matched by: lowercased, every run of characters that are not letters or
 * digits made one space. Two wordings that differ only in case and punctuation are one cause.
 * @param {string} cause @returns {string}
 */
export function sightingKey(cause) {
  return String(cause)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The line in an item's body that says which cause it tracks. @param {string} key */
export const keyLine = (key) => `Sighting key: \`${key}\``;

/**
 * Whether an item's body tracks the cause with this key.
 * @param {string} body @param {string} key
 */
export const tracks = (body, key) =>
  String(body ?? '')
    .split('\n')
    .some((l) => l.trim() === keyLine(key));

/**
 * Every sighting in the store, oldest first. A line that is not a sighting is skipped.
 * @param {import('../store/store.mjs').PrivateStore} store
 * @returns {Sighting[]}
 */
export function readSightings(store) {
  /** @type {Sighting[]} */
  const out = [];
  for (const key of store.list(SIGHTINGS_DIR).filter((k) => k.endsWith('.jsonl'))) {
    for (const line of (store.read(key) ?? '').split('\n')) {
      if (!line.trim()) continue;
      try {
        const s = JSON.parse(line);
        if (s && typeof s.key === 'string' && typeof s.at === 'string') out.push(s);
      } catch {
        // A damaged line is not a sighting.
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Append a sighting to this writer's file.
 * @param {import('../store/store.mjs').PrivateStore} store @param {Sighting} sighting
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [o]
 */
export function recordSighting(store, sighting, o = {}) {
  const writer = resolveWriter(store, o);
  store.append(`${SIGHTINGS_DIR}${writer}.jsonl`, `${JSON.stringify(sighting)}\n`);
}

/**
 * The sightings of a cause since it was last filed or appended to an item: what counts toward
 * filing it. A cause whose item was closed and is seen again starts counting afresh.
 * @param {Sighting[]} all @param {string} key
 */
export function sinceFiled(all, key) {
  const mine = all.filter((s) => s.key === key && !s.security);
  const last = mine.findLastIndex((s) => typeof s.item === 'string');
  return mine.slice(last + 1);
}

/**
 * Whether the sightings so far file an item: a second one, or one that changes a decision or a
 * safety rule.
 * @param {Sighting[]} pending the sightings since the cause was last filed, the new one included
 */
export const files = (pending) => pending.length >= 2 || pending.some((s) => !!s.decision);

/**
 * Text in a fenced block, with a fence longer than any run of backticks in it, cut at the limit.
 * @param {string} text
 */
export function fenced(text) {
  const t = text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n[cut]` : text;
  const longest = Math.max(0, ...(t.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${t.replace(/\s+$/, '')}\n${fence}`;
}

/** One sighting as evidence: where and when, what was run or read, its output. @param {Sighting} s */
function evidence(s) {
  const lines = [`### ${s.at.slice(0, 10)} in ${s.where}`, ''];
  lines.push(`${s.from === 'event' ? 'Event' : 'Command'}: ${s.what}`, '');
  if (s.output?.trim()) lines.push('Output:', '', fenced(s.output), '');
  lines.push(`Blocks: ${s.blocks}`);
  return lines.join('\n');
}

/**
 * The body of the item a cause is filed as: Done when, Why, the evidence of every sighting since
 * it was last filed, and how it was filed.
 * @param {{ pending: Sighting[], earlier?: { id: string, state: string }[] }} o
 * @returns {string}
 */
export function itemBody({ pending, earlier = [] }) {
  const last = pending[pending.length - 1];
  const known = pending.map((s) => s.known_cause).findLast((c) => !!c);
  const decision = pending.map((s) => s.decision).findLast((d) => !!d);
  const n = pending.length;
  const doneWhen = known
    ? 'The problem under Evidence no longer happens: a test reproduces it, failing before the fix and passing after it.'
    : 'The cause of the problem under Evidence is found and written in this item, and a bug report is filed for it or the fix lands with this item; or the item is dropped with the reason.';
  const why = [
    `The chief of staff saw this ${n === 1 ? 'once' : `${n} times`}${n > 1 ? `, last in ${last.where}` : ` in ${last.where}`}. It blocks: ${last.blocks}.`,
    ...(decision ? ['', `It changes a decision or a safety rule: ${decision}.`] : []),
  ];
  const kind = known
    ? `Bug report: the cause is known. ${known}`
    : 'Investigation: the cause is not known yet.';
  const notes = [
    'Filed by the chief of staff on its own, without being asked, when it saw the problem ' +
      (n > 1 ? 'again' : 'once with a decision hanging on it') +
      '. It is proposed: the owner can plan it or drop it. Later sightings are added here as dated notes, not filed again.',
    ...earlier.map((e) => `Earlier item for the same cause: ${e.id} (${e.state}).`),
  ];
  return [
    '',
    '## Done when',
    '',
    `- ${doneWhen}`,
    '',
    '## Why',
    '',
    ...why,
    '',
    '## Evidence',
    '',
    kind,
    '',
    keyLine(last.key),
    '',
    `Seen ${n} ${n === 1 ? 'time' : 'times'}.`,
    '',
    ...pending.flatMap((s) => [evidence(s), '']),
    '## Notes',
    '',
    ...notes.flatMap((l) => [l, '']),
  ].join('\n');
}

/**
 * The note a later sighting adds to the item that tracks its cause. An item that does not carry
 * the cause's key yet (one found by a search, filed by hand) gets it, so the next sighting finds it.
 * @param {Sighting} s @param {number} count how many times the cause has been seen in all
 * @param {{ withKey?: boolean }} [o]
 */
export function seenAgainNote(s, count, o = {}) {
  const ev = evidence(s).split('\n').slice(2).join('\n');
  return [
    `## Seen again on ${s.at.slice(0, 10)}`,
    '',
    `In ${s.where}. Sightings recorded so far: ${count}.`,
    '',
    ...(o.withKey ? [keyLine(s.key), ''] : []),
    ev,
    ...(s.known_cause ? ['', `The cause is now known: ${s.known_cause}`] : []),
    ...(s.decision ? ['', `It changes a decision or a safety rule: ${s.decision}.`] : []),
    '',
  ].join('\n');
}
