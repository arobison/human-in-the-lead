// Friction in Claude Code's own record of a session (HITLD-595): what the deterministic friction
// classes are read from. The core knows only the neutral observations this returns
// (core/lib/friction/friction.mjs); the shape of the record stays here.
//
// The record is a cloud session's event list as it is saved (its pages, or the events one per
// line), or what claude -p --output-format stream-json writes. Each event is an envelope
// ({ created_at, <kind>: payload }), the payload carrying the message and, where the harness adds
// them, its fields under internal_anthropic_catchall. Both are walked, not relied on. Observed in a
// cloud session on 2026-11-20, none of it documented:
//   - a question box is an AskUserQuestion tool_use; its answer the tool_result with its ID. A box
//     is dropped when a restart, an error or an interrupt closes it unanswered
//   - an interrupt is a user turn or a tool_result whose text starts "[Request interrupted by user"
//   - a permission denial is a tool_result whose permission_decision is not accept
//   - a worker restart is a system init after the first; a compaction a compact_boundary or a
//     compaction event
//   - an owner message is a user turn of text alone: not a tool_result, not synthetic, not a
//     message from another session, and not a harness notice (text that opens with a tag)
// Message text is read only to tell a question repeated and for the independent reader; nothing
// here copies it into an observation.

import { jsonValues } from './completion.mjs';

/**
 * @typedef {import('../../lib/friction/friction.mjs').Observation} Observation
 * @typedef {import('../../lib/friction/friction.mjs').ReadableMessage} ReadableMessage
 * @typedef {{ observations: Observation[], messages: ReadableMessage[], events: number }} SessionFriction
 */

/** The tool that shows the owner a question box. */
export const QUESTION_TOOL = 'AskUserQuestion';
const INTERRUPT = /^\[Request interrupted by user/;
/** Seconds within which interrupt markers are one interrupt (the harness writes one per layer). */
const SAME_INTERRUPT_S = 5;
/** Seconds after a question within which a restart is taken as what dropped it. */
const RESTART_CAUSE_S = 60;

/**
 * The events of a record, oldest first, each as { at, ref, kind, p }: p is the payload with its
 * internal_anthropic_catchall fields merged in. An event seen twice (pages that overlap) counts once.
 * @param {string} text
 */
function eventsOf(text) {
  /** @type {{ at: string, ref: string, kind: string, p: Record<string, any>, i: number }[]} */
  const out = [];
  const seen = new Set();
  /** @param {unknown} v @param {number} depth */
  const walk = (v, depth) => {
    if (depth > 6 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = /** @type {Record<string, any>} */ (v);
    const kind = ['user', 'assistant', 'system', 'result', 'other'].find(
      (k) => o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]),
    );
    if (kind && typeof o.created_at === 'string') {
      const p = { ...o[kind], ...(o[kind].internal_anthropic_catchall ?? {}) };
      const ref = typeof p.uuid === 'string' ? p.uuid : null;
      const at = isoOf(o.created_at);
      if (ref && at && !seen.has(ref)) {
        seen.add(ref);
        out.push({ at, ref, kind, p, i: out.length });
      }
      return;
    }
    if (typeof o.type === 'string' && typeof o.uuid === 'string') {
      // stream-json: the message itself, with its type and, on a user or assistant turn, timestamp
      const at = isoOf(o.timestamp ?? o.created_at);
      if (at && !seen.has(o.uuid)) {
        seen.add(o.uuid);
        out.push({ at, ref: o.uuid, kind: o.type, p: o, i: out.length });
      }
      return;
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  for (const v of jsonValues(text)) walk(v, 0);
  return out.sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.i - b.i));
}

/** @param {unknown} v */
function isoOf(v) {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** @param {Record<string, any>} p @returns {any[]} */
const contentOf = (p) => {
  const c = p.message?.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
};

/** @param {unknown} c a tool_result's content */
const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n')
      : '';

/** @param {Record<string, any>} input an AskUserQuestion input */
const questionText = (input) => {
  const qs = Array.isArray(input?.questions) ? input.questions : [];
  return qs
    .map((/** @type {any} */ q) => (typeof q?.question === 'string' ? q.question : ''))
    .filter(Boolean)
    .join('\n');
};

/** @param {string} s */
const normalized = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The friction a session record shows: one observation per sighting of a deterministic class, and
 * the messages the independent reader is given.
 * @param {string} text the record, as saved
 * @returns {SessionFriction}
 */
export function sessionFriction(text) {
  const events = eventsOf(text);
  /** @type {Observation[]} */
  const observations = [];
  /** @type {ReadableMessage[]} */
  const messages = [];
  /** @type {Map<string, { ref: string, at: string, text: string, state: 'open' | 'answered' | 'dropped', cause?: string }>} */
  const questions = new Map();
  /** @type {{ ref: string, at: string, text: string, dropped?: boolean }[]} */
  const asked = [];
  let inits = 0;
  let lastInterrupt = -Infinity;

  for (const e of events) {
    const { p } = e;
    const subtype = typeof p.subtype === 'string' ? p.subtype : '';
    const type = typeof p.type === 'string' ? p.type : '';
    if (subtype === 'init') {
      if (inits++ > 0) {
        observations.push({ class: 'worker-restart', ref: e.ref, at: e.at });
        // A restart closes every open box: what was asked in it is never answered.
        for (const q of questions.values()) {
          if (q.state !== 'open') continue;
          q.state = 'dropped';
          if (Date.parse(e.at) - Date.parse(q.at) <= RESTART_CAUSE_S * 1000) q.cause = 'restart';
        }
      }
      continue;
    }
    if (subtype === 'compact_boundary' || type === 'compaction') {
      observations.push({ class: 'compaction', ref: e.ref, at: e.at });
      continue;
    }
    if (e.kind === 'assistant') {
      for (const b of contentOf(p)) {
        if (b?.type !== 'tool_use' || b.name !== QUESTION_TOOL || typeof b.id !== 'string')
          continue;
        const q = questionText(b.input);
        const earlier = asked.find((a) => q && normalized(a.text) === normalized(q));
        if (earlier) {
          observations.push({
            class: 'question-repeated',
            ref: e.ref,
            at: e.at,
            ...(questions.get(earlier.ref)?.state === 'dropped' ? { cause: 'dropped' } : {}),
          });
        }
        questions.set(b.id, { ref: e.ref, at: e.at, text: q, state: 'open' });
        asked.push({ ref: b.id, at: e.at, text: q });
        if (q) messages.push({ ref: e.ref, at: e.at, kind: 'question', text: q });
      }
      continue;
    }
    if (e.kind !== 'user') continue;
    const blocks = contentOf(p);
    const results = blocks.filter((b) => b?.type === 'tool_result');
    if (results.length) {
      const decisions = Array.isArray(p.tool_result_meta) ? p.tool_result_meta : [];
      for (const r of results) {
        const q = questions.get(r.tool_use_id);
        const interrupted = INTERRUPT.test(textOf(r.content)) || p.tool_use_result?.interrupted;
        if (q?.state === 'open') q.state = interrupted || r.is_error ? 'dropped' : 'answered';
        if (interrupted && Date.parse(e.at) - lastInterrupt > SAME_INTERRUPT_S * 1000) {
          observations.push({ class: 'owner-interrupt', ref: e.ref, at: e.at });
          lastInterrupt = Date.parse(e.at);
        }
        const d = decisions.find((m) => m?.id === r.tool_use_id)?.permission_decision?.decision;
        if (typeof d === 'string' && d !== 'accept') {
          observations.push({ class: 'permission-denied', ref: e.ref, at: e.at });
        }
      }
      continue;
    }
    const words = blocks
      .map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
      .join('\n')
      .trim();
    if (!words) continue;
    if (INTERRUPT.test(words)) {
      if (Date.parse(e.at) - lastInterrupt > SAME_INTERRUPT_S * 1000) {
        observations.push({ class: 'owner-interrupt', ref: e.ref, at: e.at });
      }
      lastInterrupt = Date.parse(e.at);
      continue;
    }
    if (p.isSynthetic === true || p.isMeta === true || p.inbound_origin || words.startsWith('<')) {
      continue;
    }
    messages.push({ ref: e.ref, at: e.at, kind: 'owner', text: words });
    const open = [...questions.values()].some((q) => q.state === 'open' && q.at < e.at);
    if (open) observations.push({ class: 'reply-lost', ref: e.ref, at: e.at, cause: 'box-open' });
  }

  // A box still open when the record ends is not counted: it may yet be answered.
  for (const q of questions.values()) {
    if (q.state !== 'dropped') continue;
    observations.push({
      class: 'question-dropped',
      ref: q.ref,
      at: q.at,
      ...(q.cause ? { cause: q.cause } : {}),
    });
  }
  observations.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { observations, messages, events: events.length };
}
