// Friction signals (HITLD-595, design part 18.4): friction events in the ledger, each with a
// class, a source, an evidence reference and the decision count at that moment, so the friction
// controller (HITLD-596) can take rates per decision, not per day.
//
// Two kinds of class. Deterministic ones are read from the harness's record of a session by its
// adapter (core/harness/<id>/friction.mjs), with no model. Semantic ones are classified by an
// independent reader, never the chief of staff (design part 18.3): the reader's output is checked
// here before anything is recorded, and what does not pass is left unclassified, never guessed.
//
// A friction event's ID is its class and the evidence's ID, so a second scan of the same record
// appends nothing.

import { appendEvent, readLedger } from '../ledger/ledger.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 * @typedef {{ class: string, ref: string, at: string, cause?: string }} Observation
 *   one sighting of a deterministic class, as a harness adapter reads it from a session record:
 *   the record's ID for the evidence, and its time
 * @typedef {{ ref: string, at: string, kind: 'owner' | 'question', text: string }} ReadableMessage
 *   a message the independent reader classifies: the owner's own words, or a question the session
 *   put to the owner
 * @typedef {'owner' | 'delegate' | 'system'} FrictionSource
 * @typedef {{ source: FrictionSource, kind: 'deterministic' | 'semantic', reads?: 'owner' | 'question', what: string }} FrictionClass
 * @typedef {{ ref: string, class: string | null, quote?: string, confidence?: number, cause?: string }} Classified
 *   one line of the independent reader's output: class null when it found none
 */

/**
 * The starting classes, from the first retrospective's findings (HITLD-589). The controller
 * (HITLD-596) refines them; a new class is a schema change (friction_class in
 * schemas/ledger-entry.schema.json).
 * @type {Readonly<Record<string, FrictionClass>>}
 */
export const FRICTION_CLASSES = Object.freeze({
  'question-dropped': {
    source: 'system',
    kind: 'deterministic',
    what: 'a question box closed unanswered (a restart, an error or an interrupt)',
  },
  'question-repeated': {
    source: 'system',
    kind: 'deterministic',
    what: 'a question asked again in the same words',
  },
  'worker-restart': { source: 'system', kind: 'deterministic', what: 'the session restarted' },
  'owner-interrupt': {
    source: 'owner',
    kind: 'deterministic',
    what: 'the owner interrupted a turn or a tool call',
  },
  compaction: { source: 'system', kind: 'deterministic', what: 'the context was compacted' },
  'reply-lost': {
    source: 'owner',
    kind: 'deterministic',
    what: 'the owner wrote while a question box was open',
  },
  'permission-denied': {
    source: 'delegate',
    kind: 'deterministic',
    what: 'a tool call was refused by the permission mode',
  },
  'owner-correction': {
    source: 'owner',
    kind: 'semantic',
    reads: 'owner',
    what: 'the owner corrected a claim',
  },
  'repeated-instruction': {
    source: 'owner',
    kind: 'semantic',
    reads: 'owner',
    what: 'the owner repeated a standing instruction',
  },
  'owner-did-work': {
    source: 'owner',
    kind: 'semantic',
    reads: 'owner',
    what: 'the owner did or found work the system should have',
  },
  'bundled-question': {
    source: 'system',
    kind: 'semantic',
    reads: 'question',
    what: 'a question bundled several decisions',
  },
  'already-decided': {
    source: 'system',
    kind: 'semantic',
    reads: 'question',
    what: 'a question asked for something already decided',
  },
});

/** The longest evidence quote kept: a pointer to the message, never a copy of it. */
export const QUOTE_MAX = 120;
/** A reader's classification below this confidence is left unclassified. */
export const MIN_CONFIDENCE = 0.7;

/**
 * The owner decisions settled up to a moment: answered events the owner gave, not a default.
 * @param {LedgerEntry[]} events
 * @param {string} at
 */
export function decisionsAt(events, at) {
  const t = Date.parse(at);
  return events.filter(
    (e) => e.event === 'answered' && e.via !== 'default' && Date.parse(e.at) <= t,
  ).length;
}

/** @param {string} cls @param {string} ref */
export const frictionId = (cls, ref) => `friction-${cls}-${ref}`;

/**
 * The friction event for one sighting.
 * @param {{ class: string, ref: string, at: string, quote?: string, cause?: string, confidence?: number, session?: string, source?: FrictionSource }} s
 * @param {LedgerEntry[]} events the ledger, for the decision count
 * @returns {LedgerEntry}
 */
export function frictionEvent(s, events) {
  const c = FRICTION_CLASSES[s.class];
  if (!c) throw new Error(`unknown friction class ${JSON.stringify(s.class)}`);
  return {
    id: frictionId(s.class, s.ref),
    event: 'friction',
    at: s.at,
    friction_class: s.class,
    source: s.source ?? c.source,
    evidence: { ref: s.ref, at: s.at, ...(s.quote ? { quote: s.quote } : {}) },
    decisions: decisionsAt(events, s.at),
    ...(s.cause ? { cause: s.cause } : {}),
    ...(s.confidence !== undefined ? { confidence: s.confidence } : {}),
    ...(s.session ? { session: s.session } : {}),
  };
}

/** @param {string} s */
const squeezed = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * The independent reader's output, checked against the messages it was given. A line passes when
 * its message is one of them, its class is a semantic class that reads that kind of message, its
 * quote is a short, exact part of the message, and its confidence is at least the minimum. A line
 * with no class, or below the confidence, is unclassified; any other failure is rejected, with the
 * reason. Nothing is guessed.
 * @param {ReadableMessage[]} messages
 * @param {Classified[]} lines
 * @param {{ minConfidence?: number }} [o]
 */
export function acceptClassified(messages, lines, o = {}) {
  const min = o.minConfidence ?? MIN_CONFIDENCE;
  const byRef = new Map(messages.map((m) => [m.ref, m]));
  /** @type {{ class: string, ref: string, at: string, quote: string, confidence: number, cause?: string }[]} */
  const accepted = [];
  /** @type {{ ref: string, reason: string }[]} */
  const rejected = [];
  const unclassified = new Set(messages.map((m) => m.ref));
  for (const l of lines) {
    const m = byRef.get(l?.ref);
    if (!m) {
      rejected.push({ ref: String(l?.ref), reason: 'not a message the reader was given' });
      continue;
    }
    if (l.class === null || l.class === undefined) continue;
    const c = FRICTION_CLASSES[l.class];
    if (!c || c.kind !== 'semantic') {
      rejected.push({ ref: m.ref, reason: `${JSON.stringify(l.class)} is not a semantic class` });
      continue;
    }
    if (c.reads !== m.kind) {
      const what = (/** @type {string} */ k) =>
        k === 'owner' ? "the owner's messages" : 'questions';
      rejected.push({
        ref: m.ref,
        reason: `${l.class} is read from ${what(c.reads ?? '')}, not ${what(m.kind)}`,
      });
      continue;
    }
    const quote = typeof l.quote === 'string' ? squeezed(l.quote) : '';
    if (!quote || quote.length > QUOTE_MAX || !squeezed(m.text).includes(quote)) {
      rejected.push({
        ref: m.ref,
        reason: `the quote must be an exact part of the message, at most ${QUOTE_MAX} characters`,
      });
      continue;
    }
    const conf = l.confidence;
    if (typeof conf !== 'number' || !(conf >= 0 && conf <= 1)) {
      rejected.push({ ref: m.ref, reason: 'confidence must be a number from 0 to 1' });
      continue;
    }
    if (conf < min) continue;
    accepted.push({
      class: l.class,
      ref: m.ref,
      at: m.at,
      quote,
      confidence: conf,
      ...(typeof l.cause === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(l.cause)
        ? { cause: l.cause }
        : {}),
    });
  }
  for (const a of accepted) unclassified.delete(a.ref);
  return { accepted, rejected, unclassified: [...unclassified] };
}

/**
 * How far a reader agrees with a sample the owner rated by hand: per message, the same class (or
 * the same none). The cascade (HITLD-581) uses the cheapest reader whose agreement passes.
 * @param {{ ref: string, class: string | null }[]} sample
 * @param {{ class: string, ref: string }[]} accepted the reader's accepted lines
 */
export function agreement(sample, accepted) {
  const got = new Map(accepted.map((a) => [a.ref, a.class]));
  const disagreed = sample
    .filter((s) => (got.get(s.ref) ?? null) !== (s.class ?? null))
    .map((s) => ({ ref: s.ref, rated: s.class ?? null, read: got.get(s.ref) ?? null }));
  const agreed = sample.length - disagreed.length;
  return {
    agreed,
    total: sample.length,
    rate: sample.length ? agreed / sample.length : 0,
    disagreed,
  };
}

/**
 * Append the friction events of one scan: the deterministic observations, and the reader's
 * accepted lines when given. Events already in the ledger are left as they are.
 * @param {PrivateStore} store
 * @param {{ observations: Observation[], accepted?: { class: string, ref: string, at: string, quote: string, confidence: number, cause?: string }[], session?: string }} scan
 * @param {{ dryRun?: boolean }} [o]
 */
export function recordFriction(store, scan, o = {}) {
  const { events } = readLedger(store);
  const have = new Set(events.map((e) => e.id));
  const wanted = [...scan.observations, ...(scan.accepted ?? [])].map((s) =>
    frictionEvent({ ...s, ...(scan.session ? { session: scan.session } : {}) }, events),
  );
  const fresh = wanted.filter(
    (e, i) => !have.has(e.id) && wanted.findIndex((w) => w.id === e.id) === i,
  );
  if (!o.dryRun) for (const e of fresh) appendEvent(store, e);
  return { appended: fresh, already: wanted.length - fresh.length };
}
