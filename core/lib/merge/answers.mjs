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
import { parseItem } from '../tracker/files/frontmatter.mjs';

/** The front matter fields that make up a decision's answer. */
export const ANSWER_FIELDS = ['answer', 'answered_at', 'answered_via', 'answered_by'];

/**
 * A file's front matter at a commit; null when the file is not there or has none.
 * @param {string} dir @param {string} commit @param {string} path
 * @returns {Record<string, string | string[]> | null}
 */
function dataAt(dir, commit, path) {
  const r = spawnSync('git', ['show', `${commit}:${path}`], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return parseItem(r.stdout).data;
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
