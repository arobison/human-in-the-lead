// Decision answers a pull request changes, checked against what `hitld rights answer` recorded
// (HITLD-150, decision HITLD-310). A decision's answer lives in its tracker item, so a pull request
// that changes only work/ could write one, and under the owner's delegation it would merge without
// asking. Before such a merge, each decision whose answer fields the diff changes is checked: the
// answer must be one the rights flow recorded, at the same time: an `answered` ledger event
// (`rights answer`, `rights record`, or a default applied), with the same text where the event
// holds it, or a precedent's application (`rights ask`), with the same precedent. One that is not
// waits for the owner.
// The changes are read from the diff alone: the item at the merge base and at the head.

import { spawnSync } from 'node:child_process';
import { checkCode } from '../rights/flow.mjs';
import { parseItem } from '../tracker/files/frontmatter.mjs';
import { decisionBody } from '../tracker/files/tracker.mjs';

/** The front matter fields that make up a decision's answer. */
export const ANSWER_FIELDS = ['answer', 'answered_at', 'answered_via', 'answered_by'];

/**
 * A file at a commit, read as an item: its front matter (null when it has none) and its body; null
 * when the file is not there.
 * @param {string} dir @param {string} commit @param {string} path
 * @returns {{ data: Record<string, string | string[]> | null, body: string } | null}
 */
function itemAt(dir, commit, path) {
  const r = spawnSync('git', ['show', `${commit}:${path}`], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const { data, body } = parseItem(r.stdout);
  return { data, body };
}

/**
 * A file's front matter at a commit; null when the file is not there or has none.
 * @param {string} dir @param {string} commit @param {string} path
 * @returns {Record<string, string | string[]> | null}
 */
function dataAt(dir, commit, path) {
  return itemAt(dir, commit, path)?.data ?? null;
}

/**
 * A decision's answer fields, or null when the data is not a decision item.
 * @param {Record<string, string | string[]> | null} data
 */
function answerOf(data) {
  if (!data || data.kind !== 'decision') return null;
  return Object.fromEntries(ANSWER_FIELDS.map((k) => [k, data[k] ?? null]));
}

/**
 * The decisions whose answer the diff from base to head changes and that no recorded answer
 * matches, each with why. A change counts when a file is a decision item on either side and its
 * answer fields differ: an answer added, rewritten or removed, or a decision turned into another
 * kind. It is verified only when the head holds an answer, the ledger holds an `answered` event for
 * that decision at its `answered_at` (a default for a default), with the same text when the event
 * records one, and the base did not already hold an answer from that same time (rights answer
 * never answers a decision twice).
 * @param {{ dir: string, base: string, head: string, paths: string[], events: Record<string, any>[] }} o
 *   events: the ledger's effective events (corrections applied), and each precedent application as
 *   an answered event with via "precedent" (recordedAnswers)
 * @returns {{ decision: string, path: string, why: string }[]}
 */
export function unverifiedAnswers(o) {
  /** @type {{ decision: string, path: string, why: string }[]} */
  const out = [];
  const answered = o.events.filter(
    (e) => e.event === 'answered' && typeof e.decision === 'string' && e.corrects === undefined,
  );
  for (const path of o.paths) {
    if (!path.endsWith('.md')) continue;
    const before = dataAt(o.dir, o.base, path);
    const after = dataAt(o.dir, o.head, path);
    const was = answerOf(before);
    const now = answerOf(after);
    if (!was && !now) continue;
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    const id = String((after ?? before)?.id ?? path);
    /** @param {string} why */
    const refuse = (why) => out.push({ decision: id, path, why });
    if (!now || now.answer === null) {
      refuse(was?.answer ? 'its answer is removed' : 'its answer fields change with no answer');
      continue;
    }
    if (typeof now.answer !== 'string' || typeof now.answered_at !== 'string') {
      refuse('its answer has no answered_at');
      continue;
    }
    if (was && was.answer !== null && was.answered_at === now.answered_at) {
      refuse('an answer already given is rewritten');
      continue;
    }
    const hit = answered.find((e) => e.decision === id && e.at === now.answered_at);
    if (!hit) {
      refuse(`no answer to ${id} at ${now.answered_at} is recorded`);
      continue;
    }
    const via = ['default', 'precedent'].includes(String(now.answered_via))
      ? now.answered_via
      : undefined;
    if (hit.via !== via) {
      refuse('how it was answered differs from the record');
      continue;
    }
    if (typeof hit.text === 'string' && hit.text !== now.answer) {
      refuse('its answer differs from the one recorded');
      continue;
    }
    if (hit.via === 'precedent' && after?.resolved_by_precedent !== hit.precedent) {
      refuse('the precedent it cites is not the one applied');
    }
  }
  return out;
}

/**
 * What the rights flow recorded of answers, for unverifiedAnswers: the ledger's effective events,
 * and each precedent's application from the trust record as an answered event.
 * @param {Record<string, any>[]} ledger effective ledger events @param {Record<string, any>[]} trust
 * @returns {Record<string, any>[]}
 */
export function recordedAnswers(ledger, trust) {
  return [
    ...ledger.filter((e) => e.event === 'answered'),
    ...trust
      .filter((e) => e.kind === 'application' && typeof e.subject === 'string')
      .map((e) => ({
        event: 'answered',
        decision: e.subject,
        at: e.at,
        via: 'precedent',
        precedent: e.precedent,
      })),
  ];
}

// What a merge the owner did not approve may change in the tracker (HITLD-871). The answer check
// above reads four fields of a decision, so on its own it let a branch whose files are all under
// the tracker's folder rewrite a decision's question or options, another item's Done-when, or add
// items whose bodies become later executors' briefs, and merge under the owner's delegation. Such a
// merge may change three things in the tracker:
//   - the file of the item its branch claimed, except the fields that carry rights or ordering
//     (OWNER_FIELDS) and any state change the claim and close flow does not make (CLAIM_FLOW);
//   - a decision already on main, only by the answer the rights flow recorded (state, answer and
//     what answering writes; its question, options and body as they were);
//   - a decision it adds, answered by the owner, when its title and body are exactly what the
//     rights flow renders from the question it recorded asking (the ask record in the private
//     store, true to its own check code) and its answer is the one recorded: a choice the chief of
//     staff recorded and published.
// Anything else in the tracker waits for the owner: a decision changed any other way or added
// otherwise, another item, a milestone, a project, a view, any other tracker file. A change no
// merge without the owner may carry, whichever file holds it, is refused: an item promoted out of
// `proposed`, which only the owner's decision does.

/** What answering a decision writes besides ANSWER_FIELDS (an answer, a default, a precedent). */
const ANSWERING_WRITES = ['state', 'reason', 'rationale', 'precedent', 'resolved_by_precedent'];

/** The states an item reaches from `proposed` only by the owner's decision. */
const PROMOTED = ['planned', 'in-progress', 'done'];

/** The fields of the claimed item that carry rights or ordering: they change only with the owner's yes. */
export const OWNER_FIELDS = ['constraint_of', 'project', 'needs', 'holds'];

/** The state changes the claim and close flow makes to the claimed item, from main's state. */
const CLAIM_FLOW = /** @type {Record<string, string[]>} */ ({
  planned: ['in-progress', 'done'],
  'in-progress': ['done'],
});

/** Whitespace collapsed: a body Prettier wrapped reads the same. @param {string} t */
const squash = (t) => t.replace(/\s+/g, ' ').trim();

/**
 * Why the claimed item's file changes beyond what its branch may change without the owner: the
 * fields that carry rights or ordering, and a state change outside the claim and close flow.
 * @param {Record<string, any>} b @param {Record<string, any>} a @returns {string[]}
 */
function ownBeyond(b, a) {
  const out = OWNER_FIELDS.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map(
    (k) => `its ${k} changes`,
  );
  if (b.state !== a.state && !(CLAIM_FLOW[String(b.state)] ?? []).includes(String(a.state))) {
    out.push(
      `its state goes from ${b.state} to ${a.state}, which the claim and close flow never does`,
    );
  }
  return out;
}

/**
 * Why a decision the branch adds is not a choice the rights flow recorded, or null when it is: it
 * is done and answered by the owner, its ask record is there and true to its check code, and its
 * title and body are what the rights flow renders from that record. Its answer is the answer
 * check's to verify.
 * @param {Record<string, any>} a its front matter @param {string} body
 * @param {import('../rights/flow.mjs').AskedRecord | null} rec
 */
function addedNotRecorded(a, body, rec) {
  if (a.state !== 'done' || a.answer === undefined || a.answer === null) {
    return 'it is added unanswered';
  }
  if (a.answered_by !== 'owner') return "it is added with an answer that is not the owner's";
  if (!rec) return 'no question under its ID is recorded as asked';
  if (!rec.check || checkCode(rec) !== rec.check) {
    return 'the recorded question does not match its own check code';
  }
  if (String(a.title) !== rec.title) return 'its title is not the one recorded asking it';
  const rendered = decisionBody({
    question: rec.question,
    context: rec.context,
    options: rec.options,
    recommendation: rec.recommendation,
    ...(rec.basis ? { rights_basis: rec.basis } : {}),
    ...(rec.reversibility ? { reversibility: rec.reversibility } : {}),
    ...(rec.default_if_unanswered ? { default_if_unanswered: rec.default_if_unanswered } : {}),
    ...(rec.offer ? { precedent_offer: rec.offer } : {}),
  });
  if (squash(body) !== squash(rendered)) return 'its body is not the question recorded asking it';
  return null;
}

/**
 * @typedef {{ path: string, item: string | null, why: string }} ScopeFinding a tracker file a
 *   merge without the owner may not change as it does, with the item it holds and why
 */

/**
 * Whether a decision's file changes only by being answered: its answer fields change, it is done
 * after, it held no answer before, and nothing else in its front matter or body differs.
 * @param {{ data: Record<string, any>, body: string }} before
 * @param {{ data: Record<string, any>, body: string }} after
 */
function onlyAnswered(before, after) {
  if (before.data.answer !== undefined && before.data.answer !== null) return false;
  if (after.data.state !== 'done') return false;
  if (JSON.stringify(answerOf(before.data)) === JSON.stringify(answerOf(after.data))) return false;
  if (before.body !== after.body) return false;
  const kept = new Set([...ANSWER_FIELDS, ...ANSWERING_WRITES]);
  const keys = new Set([...Object.keys(before.data), ...Object.keys(after.data)]);
  return [...keys].every(
    (k) => kept.has(k) || JSON.stringify(before.data[k]) === JSON.stringify(after.data[k]),
  );
}

/**
 * The tracker changes a merge made without the owner may not carry (the rule above), from the diff
 * alone: each file at the merge base and at the head. `waits`: each makes the merge wait for the
 * owner. `refused`: each refuses it outright, whoever would merge it without the owner's decision.
 * A file the answer check already holds back (`unverified`, by path) is left to it.
 * @param {{ dir: string, base: string, head: string, paths: string[], workDir?: string,
 *   claimed: string | null, unverified?: string[],
 *   asked?: (id: string) => import('../rights/flow.mjs').AskedRecord | null }} o claimed: the item
 *   the branch was dispatched for, from the ledger, never from the branch; null for a branch no
 *   dispatch claimed (a published tracker change). asked: a decision's ask record, from the
 *   private store, when the ledger records it asked; null otherwise, and when not given
 * @returns {{ waits: ScopeFinding[], refused: ScopeFinding[] }}
 */
export function delegatedTrackerScope(o) {
  const prefix = `${(o.workDir ?? 'work').replace(/\/+$/, '')}/`;
  const held = new Set(o.unverified ?? []);
  /** @type {ScopeFinding[]} */
  const waits = [];
  /** @type {ScopeFinding[]} */
  const refused = [];
  for (const path of o.paths) {
    if (!path.startsWith(prefix)) continue;
    const before = itemAt(o.dir, o.base, path);
    const after = itemAt(o.dir, o.head, path);
    const b = before?.data ?? null;
    const a = after?.data ?? null;
    const id = (a ?? b)?.id !== undefined ? String((a ?? b)?.id) : null;
    const name = id ?? path;
    if (b && a && b.state === 'proposed' && PROMOTED.includes(String(a.state))) {
      refused.push({
        path,
        item: id,
        why: `${name} goes from proposed to ${a.state}: promoting an item is the owner's decision, and none is behind this change`,
      });
      continue;
    }
    if (held.has(path)) continue;
    const own =
      o.claimed !== null &&
      b?.id === o.claimed &&
      a?.id === o.claimed &&
      b?.kind === 'work' &&
      a?.kind === 'work';
    /** @param {string} why */
    const wait = (why) => waits.push({ path, item: id, why });
    if (own) {
      const beyond = ownBeyond(
        /** @type {Record<string, any>} */ (b),
        /** @type {Record<string, any>} */ (a),
      );
      if (beyond.length) {
        wait(`${name}, the claimed item, changes beyond its claim and close: ${beyond.join('; ')}`);
      }
      continue;
    }
    const kinds = [b?.kind, a?.kind];
    if (kinds.includes('decision')) {
      const answered =
        before?.data && after?.data && b?.kind === 'decision' && a?.kind === 'decision'
          ? onlyAnswered(
              /** @type {{ data: Record<string, any>, body: string }} */ (before),
              /** @type {{ data: Record<string, any>, body: string }} */ (after),
            )
          : false;
      if (answered) continue;
      const notRecorded =
        !b && a?.kind === 'decision' && after
          ? addedNotRecorded(a, after.body, id ? (o.asked?.(id) ?? null) : null)
          : 'not added';
      if (notRecorded === null) continue;
      wait(
        !b
          ? `decision ${name} is added, and it is not a choice the rights flow recorded: ${notRecorded}`
          : !a
            ? `decision ${name} is removed or is no longer an item`
            : `decision ${name} changes beyond the answer that was recorded (its question, options, body or another field)`,
      );
    } else if (kinds.includes('milestone')) {
      wait(`milestone ${name} changes`);
    } else if (!b && !a) {
      wait('a tracker file other than the claimed item changes');
    } else if (!b) {
      wait(`item ${name} is added`);
    } else if (!a) {
      wait(`item ${name} is removed`);
    } else {
      wait(
        o.claimed === null
          ? `item ${name} changes, and no dispatch claimed an item on this branch`
          : `item ${name} changes, and the branch claimed ${o.claimed}`,
      );
    }
  }
  return { waits, refused };
}
