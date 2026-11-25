// A run scope (HITLD-877, decision HITLD-876): one decision of the owner's names a list of items,
// a token budget and an end time, and within it the chief of staff starts those items itself
// (hitld dispatch start --scope), so a hand-over between orchestrators needs no start line typed
// in the orchestrator's session. It is per run, never standing: it ends at its end time, once its
// budget is spent, or on the owner's word (hitld run scope end), and a new run does not inherit it.
// It allows starts and nothing else: a guard, policy, rights or skill change is still the owner's.
//
// What grants a scope is the owner's yes, and nothing else. The question is put to the owner with
// the scope written into its title (scopeQuestion): the items, the budget and the end time the
// owner reads are the ones the answer confirms. The answer counts only as the yes option, recorded
// in this run by the rights flow (its `answered` ledger event) and on the decision item, to the
// question exactly as hitld run scope question writes it for that scope (the rights flow's ask
// record: title, question, context and options, and its check code), which that command noted it
// wrote (run/scope-questions/<hash>.json). Each question written opens one decision's scope: once
// a decision opened it, or its scope ended, a new scope needs the question asked again. The store
// file run/scope.json names which decision is in force and whether the owner ended it; it grants
// nothing by itself, and every start derives the scope from the decision, the ask record and the
// ledger again (deriveScope), so a file edited by hand adds no item, budget or time.
// A marker alone opens nothing: the question recorded must be the one the command writes for the
// scope agreed, word for word. What these checks cannot tell apart is someone who writes the
// store's ask record, ledger and marker by hand as the two commands would; the store is the
// boundary they stand on, and signed answers (design part 22) are the strong fix.
//
// Starts under it are ordinary `dispatched` events that carry the scope's decision and the session
// that started them (`by`), so what a scope has spent is read from the ledger.

import { createHash } from 'node:crypto';
import { matchesAny } from '../precedent/glob.mjs';
import { waitsForOwner } from '../merge/owner.mjs';
import { canonicalJson } from '../policy/policy.mjs';
import { checkCode } from '../rights/flow.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 * @typedef {import('../rights/flow.mjs').AskedRecord} AskedRecord
 *
 * @typedef {object} IssuedRecord what hitld run scope question notes of the questions it wrote
 *   with one check code: each time it wrote one, and each decision that one opened or ended
 * @property {string} check the check code of the question as written
 * @property {string} line the scope, in one line
 * @property {{ at: string, by: string }[]} issued
 * @property {{ decision: string, at: string }[]} used
 *
 * @typedef {object} ScopeSpec what the owner is asked to agree to
 * @property {string[]} items
 * @property {number} budget_tokens
 * @property {string} until an ISO 8601 time, as toISOString writes it
 *
 * @typedef {ScopeSpec & { run: string, decision: string, granted_at: string }} RunScope
 *   granted_at: when the owner answered yes, from the ledger
 *
 * @typedef {object} ScopeFile what the store holds: which decision is in force, and its end
 * @property {string} run
 * @property {string} decision
 * @property {string} set_at
 * @property {string} set_by
 * @property {{ at: string, by: string, reason: string }} [ended]
 *
 * @typedef {{ ok: false, code: string, why: string }} ScopeRefusal
 */

export const SCOPE_KEY = 'run/scope.json';

/** How a follow-up's dispatched event names the dispatch it continues (its notes). */
export const FOLLOW_UP_OF = 'follow-up of ';

/** The longest a scope may run, from the owner's yes: per run, never standing. */
export const SCOPE_MAX_HOURS = 168;

/** The option that grants the scope; the other option is no. */
export const SCOPE_YES = 'Yes, start them';
const SCOPE_NO = 'No';
const TITLE = /^Run scope: start (.+) within ([1-9]\d*) tokens until (\S+)$/;
/** The scope as the yes option states it, inside the answer the rights flow records. */
const IN_ANSWER = /may start (.+?) within ([1-9]\d*) tokens until (\S+?), by itself/;

/**
 * The paths whose changes are the owner's: guard, policy, rights and skills. A scope is refused
 * unless owner merge mode holds a change to each for the owner's yes (the owner's ruling on
 * HITLD-877). `in_repo` entries count only where the directory exists, as in this repository.
 * The check is by sample files under each glob, shallow and deep, not by every possible path: a
 * policy that carves out a narrower path inside one of these (a "!" glob or an area) is not seen.
 */
export const OWNER_ONLY = Object.freeze([
  {
    what: 'policy and rights',
    glob: '.human-in-the-lead/**',
    samples: ['.human-in-the-lead/policy.json', '.human-in-the-lead/any/deep/file.json'],
  },
  {
    what: 'guard and harness settings',
    glob: '.claude/**',
    samples: ['.claude/settings.json', '.claude/skills/any/SKILL.md', '.claude/hooks/any.mjs'],
  },
  {
    what: 'skills',
    glob: 'skills/**',
    samples: ['skills/any/SKILL.md', 'skills/any/deep/file.md'],
  },
  {
    what: 'guard',
    glob: 'core/lib/guard/**',
    samples: ['core/lib/guard/any.mjs', 'core/lib/guard/deep/any.mjs'],
    in_repo: 'core/lib/guard',
  },
  {
    what: 'rights',
    glob: 'core/lib/rights/**',
    samples: ['core/lib/rights/any.mjs', 'core/lib/rights/deep/any.mjs'],
    in_repo: 'core/lib/rights',
  },
]);

/** The scope in one canonical line. @param {ScopeSpec} s */
export const scopeLine = (s) =>
  `start ${s.items.join(', ')} within ${s.budget_tokens} tokens until ${s.until}`;

/** The title the decision carries: the scope as the owner reads it. @param {ScopeSpec} s */
export const scopeTitle = (s) => `Run scope: ${scopeLine(s)}`;

/**
 * The scope a decision's title states, or null when the title is not a run-scope question.
 * @param {unknown} title @returns {ScopeSpec | null}
 */
export const parseScopeTitle = (title) => specOf(TITLE.exec(String(title ?? '')));

/**
 * The scope the owner's recorded answer states (the yes option names it in full), or null.
 * @param {unknown} text @returns {ScopeSpec | null}
 */
export const parseScopeAnswer = (text) => specOf(IN_ANSWER.exec(String(text ?? '')));

/**
 * What differs between the scope the owner said yes to and the one the decision states now.
 * @param {ScopeSpec} agreed @param {ScopeSpec} now @returns {string[]}
 */
export function scopeDiff(agreed, now) {
  const out = [];
  const added = now.items.filter((i) => !agreed.items.includes(i));
  const dropped = agreed.items.filter((i) => !now.items.includes(i));
  if (added.length) out.push(`items added: ${added.join(', ')}`);
  if (dropped.length) out.push(`items removed: ${dropped.join(', ')}`);
  if (agreed.budget_tokens !== now.budget_tokens) {
    out.push(`budget ${agreed.budget_tokens} became ${now.budget_tokens} tokens`);
  }
  if (agreed.until !== now.until) out.push(`end time ${agreed.until} became ${now.until}`);
  return out;
}

/** @param {RegExpExecArray | null} m @returns {ScopeSpec | null} */
function specOf(m) {
  if (!m) return null;
  const items = m[1].split(', ').map((s) => s.trim());
  const until = Date.parse(m[3]);
  if (!items.length || items.some((i) => !/^[A-Za-z][A-Za-z0-9]*-[0-9]+$/.test(i))) return null;
  if (Number.isNaN(until) || new Date(until).toISOString() !== m[3]) return null;
  if (unnamedItems(m[1], items).length) return null;
  return { items, budget_tokens: Number(m[2]), until: m[3] };
}

/** The question's first sentence: the scope as the owner is asked it. @param {ScopeSpec} s */
const scopeAsk = (s) =>
  `May the chief of staff start ${s.items.join(', ')} itself in this run, spending at most ${s.budget_tokens} tokens, until ${s.until}?`;
/** How the sentence naming the items that touch owner paths ends. */
const REACH_END =
  ' change guard, policy, rights or skill paths; each still reaches main only with your own yes.';
const SCOPE_CONTEXT =
  'An orchestrator can start executors only on a start line you type in its session, so the run stalls at each hand-over (HITLD-877). A scope covers starts only, ends at its end time, its budget or your word, and no other run inherits it.';
/** @param {ScopeSpec} s */
const scopeOptions = (s) => [
  {
    label: SCOPE_YES,
    // The whole scope, so the answer the rights flow records in the ledger holds it.
    what_happens: `the chief of staff may ${scopeLine(s)}, by itself, within the cap and the quota gate`,
    reversible: true,
  },
  {
    label: SCOPE_NO,
    what_happens: 'nothing starts under a scope; orchestrators start work on your typed start line',
    reversible: true,
  },
];

/**
 * A question's check code, as the rights flow computes it for a recorded choice (no precedent
 * text is added to a recorded question's context). @param {Record<string, any>} q
 */
export const questionCheck = (q) =>
  checkCode({ question: q.question, context: q.context, options: q.options });

/**
 * Why the question recorded for a decision is not one hitld run scope question writes for the
 * scope the owner said yes to, or null when it is: its title, first sentence, context and options
 * exactly, the sentence naming owner-path items only in the form the command writes, and its check
 * code its own. So no rewritten question text, context or option opens a scope.
 * @param {AskedRecord | null} asked @param {ScopeSpec} agreed @returns {string | null}
 */
export function notAsWritten(asked, agreed) {
  if (!asked) return 'the question asked under it is not in the store';
  if (asked.binds || typeof asked.check !== 'string' || questionCheck(asked) !== asked.check) {
    return 'its ask record does not match its own check code';
  }
  if (asked.title !== scopeTitle(agreed)) return 'its title is not the scope it was answered for';
  const q = String(asked.question ?? '');
  const base = scopeAsk(agreed);
  if (q !== base && !(q.startsWith(`${base} Of these, `) && q.endsWith(REACH_END))) {
    return 'its question text was changed';
  }
  if (asked.context !== SCOPE_CONTEXT) return 'its context was changed';
  if (canonicalJson(asked.options) !== canonicalJson(scopeOptions(agreed))) {
    return 'its options were changed';
  }
  return null;
}

/**
 * The question to put to the owner, for hitld rights record: the scope in its title and its
 * question, the yes option first, and the named items whose touches reach the owner's paths.
 * @param {ScopeSpec} s @param {{ item: string, touches: string[] }[]} sensitive
 */
export function scopeQuestion(s, sensitive) {
  const reach = sensitive.length
    ? ` Of these, ${sensitive.map((x) => `${x.item} (${x.touches.join(', ')})`).join('; ')}${REACH_END}`
    : '';
  return {
    title: scopeTitle(s),
    question: `${scopeAsk(s)}${reach}`,
    context: SCOPE_CONTEXT,
    options: scopeOptions(s),
    recommendation: {
      option: SCOPE_YES,
      why: 'it keeps the run going across hand-overs without your typed start lines',
    },
    tags: ['run-scope'],
    reversibility: 'two-way',
  };
}

/**
 * The item IDs a text does not name as a whole ID: W-1 is not named by W-12, nor by W-1-foo.
 * @param {string} words @param {string[]} items
 */
export function unnamedItems(words, items) {
  const text = String(words).toUpperCase();
  return items.filter((id) => {
    const escaped = id.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(^|[^A-Z0-9-])${escaped}(?![0-9A-Z-])`).test(text);
  });
}

/**
 * Whether owner merge mode holds a change to every owner-only path for the owner's yes.
 * @param {Record<string, any>} policy @param {(dir: string) => boolean} exists
 * @returns {{ ok: true } | ScopeRefusal}
 */
export function ownerHoldsChanges(policy, exists) {
  if (policy.merge?.mode !== 'owner') {
    return {
      ok: false,
      code: 'scope-merge-unguarded',
      why: `merge.mode is ${policy.merge?.mode ?? 'unset'}, not owner: a run scope needs every guard, policy, rights or skill change to wait for the owner's own yes`,
    };
  }
  const open = OWNER_ONLY.filter(
    (o) => (!o.in_repo || exists(o.in_repo)) && o.samples.some((f) => !waitsForOwner([f], policy)),
  );
  if (open.length) {
    return {
      ok: false,
      code: 'scope-merge-unguarded',
      why: `merge.owner_paths and owner_areas do not hold ${open.map((o) => `${o.what} (${o.glob})`).join(', ')} for the owner's yes, checked by sample files under each: a run scope needs them to`,
    };
  }
  return { ok: true };
}

/**
 * The items whose declared touches reach an owner-only path.
 * @param {{ id: string, touches?: string[] }[]} items
 */
export function touchingOwnerPaths(items) {
  return items
    .map((i) => ({
      item: String(i.id),
      touches: (i.touches ?? []).filter((t) =>
        OWNER_ONLY.some(
          (o) => matchesAny([o.glob], t) || o.samples.some((f) => matchesAny([t], f)),
        ),
      ),
    }))
    .filter((x) => x.touches.length);
}

/** @param {PrivateStore} store @returns {ScopeFile | null} */
export function readScopeFile(store) {
  const raw = store.read(SCOPE_KEY);
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw);
    return s && typeof s === 'object' && typeof s.decision === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** @param {PrivateStore} store @param {ScopeFile} file */
export function writeScopeFile(store, file) {
  store.write(SCOPE_KEY, `${JSON.stringify(file, null, 2)}\n`);
}

/** The owner's yes, as the rights flow writes an answer to the scope question. @param {unknown} text */
const isYes = (text) => String(text ?? '').startsWith(`A. ${SCOPE_YES}:`);

/**
 * The scope a decision grants now, derived from the decision item and the ledger alone.
 * @param {{
 *   decision: Record<string, any> | null,
 *   id: string,
 *   events: LedgerEntry[],
 *   run: { id: string, started_at?: string } | null,
 *   now: number,
 *   asked: AskedRecord | null,
 *   issued: (hash: string) => IssuedRecord | null,
 * }} o asked: the rights flow's ask record of the decision; issued: what hitld run scope question
 *   noted of the question with that hash (issuedIn)
 * @returns {{ ok: true, scope: RunScope } | ScopeRefusal}
 */
export function deriveScope(o) {
  const d = o.decision;
  if (!d || d.kind !== 'decision') {
    return { ok: false, code: 'not-found', why: `${o.id} is not a decision in the tracker` };
  }
  const spec = parseScopeTitle(d.title);
  if (!spec) {
    return {
      ok: false,
      code: 'scope-not-confirmed',
      why: `${o.id} is not a run-scope question (its title is not one hitld run scope question writes): the owner has not agreed to a scope`,
    };
  }
  if (!o.run) return { ok: false, code: 'no-run', why: 'no run has started' };
  // The owner's end is in the ledger: a scope ended once stays ended, whatever the store file says.
  const ended = o.events.find((e) => e.event === 'scope-ended' && e.decision === o.id);
  if (ended) {
    return {
      ok: false,
      code: 'scope-ended',
      why: `the run scope of ${o.id} was ended at ${ended.at}${ended.notes ? ` (${ended.notes})` : ''}; it does not open again: ask the owner for a new one`,
    };
  }
  const answered = o.events.filter(
    (e) => e.event === 'answered' && e.decision === o.id && e.corrects === undefined,
  );
  const yes = answered.at(-1);
  if (d.state !== 'done' || d.answered_by !== 'owner' || !yes) {
    return {
      ok: false,
      code: 'not-answered',
      why: `${o.id} has no answer from the owner recorded through the rights flow`,
    };
  }
  if (!isYes(d.answer) || !isYes(yes.text)) {
    return {
      ok: false,
      code: 'scope-not-confirmed',
      why: `the owner's answer to ${o.id} is not "${SCOPE_YES}": no scope is open for ${spec.items.join(', ')}`,
    };
  }
  // What the owner agreed to is what the yes option stated when the answer was recorded, in the
  // ledger; the decision's title, a tracker file a branch can change, must still say the same.
  const agreed = parseScopeAnswer(yes.text);
  if (!agreed) {
    return {
      ok: false,
      code: 'scope-not-confirmed',
      why: `the owner's recorded answer to ${o.id} states no scope: it was not asked with the question hitld run scope question writes`,
    };
  }
  const changed = scopeDiff(agreed, spec);
  if (changed.length) {
    return {
      ok: false,
      code: 'scope-changed',
      why: `${o.id} no longer states the scope the owner said yes to: ${changed.join('; ')}`,
    };
  }
  // In this run: after it started, and in it where the event names a run (on a device that holds
  // no run state, as the chief of staff's may, the rights flow records none).
  const startedAt = Date.parse(String(o.run.started_at ?? ''));
  const at = Date.parse(String(yes.at));
  if (
    (yes.run !== undefined && yes.run !== o.run.id) ||
    !Number.isFinite(startedAt) ||
    !(at >= startedAt)
  ) {
    return {
      ok: false,
      code: 'scope-ended',
      why: `${o.id} was answered outside this run (${o.run.id}): a scope is per run, never standing`,
    };
  }
  // The question the owner answered is the one the command writes for this scope, word for word,
  // and the command noted writing it before the answer, for no other decision.
  const wrong = notAsWritten(o.asked, agreed);
  if (wrong) {
    return {
      ok: false,
      code: 'scope-not-confirmed',
      why: `${o.id} was not asked with the question hitld run scope question writes for ${scopeLine(agreed)}: ${wrong}`,
    };
  }
  const unissued = issueRefusal(
    o.issued(questionHash(/** @type {AskedRecord} */ (o.asked))),
    o.id,
    at,
  );
  if (unissued) {
    return {
      ok: false,
      code: 'scope-not-confirmed',
      why: `${unissued} (${scopeLine(agreed)}), so ${o.id} opens no scope: ask the owner again with a new question`,
    };
  }
  const until = Date.parse(spec.until);
  if (!(at <= o.now) || until <= at || until - at > SCOPE_MAX_HOURS * 3600_000) {
    return {
      ok: false,
      code: 'scope-invalid',
      why: `${o.id} runs from ${yes.at} to ${spec.until}: a scope ends after the owner's yes and at most ${SCOPE_MAX_HOURS} hours after it`,
    };
  }
  return {
    ok: true,
    scope: { ...agreed, run: o.run.id, decision: o.id, granted_at: String(yes.at) },
  };
}

/**
 * A question's full hash: SHA-256 over its question, context and options, what the owner reads.
 * The check code is its short form for typing; the record is keyed by the whole.
 * @param {Record<string, any>} q
 */
export const questionHash = (q) =>
  createHash('sha256')
    .update(
      canonicalJson({
        question: q.question ?? null,
        context: q.context ?? null,
        options: q.options ?? [],
      }),
    )
    .digest('hex');

/** Where hitld run scope question notes the questions it wrote with one hash. @param {string} hash */
export const issuedKey = (hash) => `run/scope-questions/${hash}.json`;

/**
 * What hitld run scope question noted of the question with a hash, from the store, or null.
 * @param {PrivateStore} store @returns {(hash: string) => IssuedRecord | null}
 */
export const issuedIn = (store) => (hash) => {
  try {
    const r = JSON.parse(store.read(issuedKey(hash)) ?? 'null');
    if (!r || typeof r.check !== 'string' || !Array.isArray(r.issued)) return null;
    return { ...r, used: Array.isArray(r.used) ? r.used : [] };
  } catch {
    return null;
  }
};

/**
 * Note that hitld run scope question wrote this question, once more.
 * @param {PrivateStore} store @param {Record<string, any>} q the question as written
 * @param {ScopeSpec} s @param {{ at: string, by: string }} issue
 */
export function noteIssued(store, q, s, issue) {
  const hash = questionHash(q);
  const before = issuedIn(store)(hash);
  /** @type {IssuedRecord} */
  const record = {
    check: questionCheck(q),
    line: scopeLine(s),
    issued: [...(before?.issued ?? []), issue],
    used: before?.used ?? [],
  };
  store.write(issuedKey(hash), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Note that a decision used a question written once: it opened its scope, or its scope ended.
 * Nothing is written when the decision is already noted, or no written question is left for it.
 * @param {PrivateStore} store @param {AskedRecord | null} asked @param {string} decision
 * @param {string} at
 */
export function noteUsed(store, asked, decision, at) {
  if (!asked) return;
  const hash = questionHash(asked);
  const record = issuedIn(store)(hash);
  if (!record || record.used.some((u) => u.decision === decision)) return;
  if (record.used.length >= record.issued.length) return;
  const next = { ...record, used: [...record.used, { decision, at }] };
  store.write(issuedKey(hash), `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * Why a written question does not open a decision's scope, or null when it does: the command must
 * have written it before the owner's answer, and each time it wrote it opens one decision only.
 * @param {IssuedRecord | null} record @param {string} decision @param {number} answeredAt
 * @returns {string | null}
 */
export function issueRefusal(record, decision, answeredAt) {
  if (!record) return 'hitld run scope question did not write this question';
  const before = record.issued.filter((i) => Date.parse(i.at) <= answeredAt).length;
  if (!before) return 'hitld run scope question wrote this question only after the answer';
  if (record.used.some((u) => u.decision === decision)) return null;
  const others = record.used.filter((u) => u.decision !== decision).length;
  return before > others
    ? null
    : `each question hitld run scope question wrote was already used, by ${record.used.map((u) => u.decision).join(', ')}`;
}

/**
 * What a scope has spent: for each start under it, the tokens its reports recorded, else its start
 * estimate (a start in flight counts at its estimate, so starting many at once cannot pass the
 * budget). One pass over the ledger.
 * @param {RunScope} scope @param {LedgerEntry[]} events
 */
export function spentOf(scope, events) {
  /** @type {Map<string, number>} */
  const estimate = new Map();
  /** @type {Map<string, number>} */
  const reported = new Map();
  for (const e of events) {
    const d = String(e.dispatch);
    // A start under the scope, or a follow-up of one (which carries no decision of its own).
    const follows =
      typeof e.notes === 'string' && e.notes.startsWith(FOLLOW_UP_OF)
        ? e.notes.slice(FOLLOW_UP_OF.length)
        : null;
    if (
      e.event === 'dispatched' &&
      ((e.decision === scope.decision && e.run === scope.run) ||
        (follows !== null && estimate.has(follows)))
    ) {
      estimate.set(d, typeof e.estimate_tokens === 'number' ? e.estimate_tokens : 0);
    } else if (e.event === 'reported' && typeof e.tokens === 'number') {
      reported.set(d, (reported.get(d) ?? 0) + e.tokens);
    }
  }
  let spent = 0;
  for (const [d, est] of estimate) spent += reported.get(d) ?? est;
  return { spent, starts: [...estimate.keys()] };
}

/**
 * Whether the scope is in force now, and if not, why: the file's end, the end time, the budget.
 * @param {RunScope} scope @param {ScopeFile | null} file
 * @param {{ now: number, events: LedgerEntry[] }} at
 * @returns {{ active: boolean, code?: string, why?: string, spent: number, left: number, starts: string[] }}
 */
export function scopeStatus(scope, file, at) {
  const { spent, starts } = spentOf(scope, at.events);
  const left = Math.max(0, scope.budget_tokens - spent);
  const base = { spent, left, starts };
  if (file?.ended) {
    return {
      active: false,
      code: 'scope-ended',
      why: `the run scope of ${scope.decision} was ended at ${file.ended.at} (${file.ended.reason})`,
      ...base,
    };
  }
  if (at.now >= Date.parse(scope.until)) {
    return {
      active: false,
      code: 'scope-expired',
      why: `the run scope of ${scope.decision} ended at ${scope.until}`,
      ...base,
    };
  }
  if (spent >= scope.budget_tokens) {
    return {
      active: false,
      code: 'scope-budget',
      why: `the run scope of ${scope.decision} has spent ${spent} of its ${scope.budget_tokens} tokens`,
      ...base,
    };
  }
  return { active: true, ...base };
}

/**
 * Whether the chief of staff may start an item now under the scope the file names, the scope
 * derived again from its decision. Refusals: `no-scope`, `outside-scope` (another decision, or an
 * item the scope does not name), `scope-invalid` (the file names another run or a time to come),
 * the refusals of deriveScope, and those of scopeStatus.
 * @param {ScopeFile | null} file
 * @param {{
 *   decision: string,
 *   item: string,
 *   estimate: number,
 *   now: number,
 *   run: { id: string, started_at?: string } | null,
 *   events: LedgerEntry[],
 *   lookup: (id: string) => Record<string, any> | null,
 *   asked: (id: string) => AskedRecord | null,
 *   issued: (hash: string) => IssuedRecord | null,
 * }} start asked: the rights flow's ask record of a decision; issued: as for deriveScope
 * @returns {{ ok: true, scope: RunScope, spent: number, left: number } | ScopeRefusal}
 */
export function checkScopeStart(file, start) {
  if (!file) return { ok: false, code: 'no-scope', why: 'no run scope is recorded' };
  if (file.decision !== start.decision) {
    return {
      ok: false,
      code: 'outside-scope',
      why: `${start.decision} is not the decision of the run scope in force (${file.decision})`,
    };
  }
  if (!start.run || file.run !== start.run.id) {
    return {
      ok: false,
      code: 'scope-ended',
      why: `the run scope of ${file.decision} belongs to run ${file.run}, not the run now (${start.run?.id ?? 'none'})`,
    };
  }
  if (!(Date.parse(file.set_at) <= start.now)) {
    return {
      ok: false,
      code: 'scope-invalid',
      why: `the run scope's record is dated ${file.set_at}, after now`,
    };
  }
  const derived = deriveScope({
    decision: start.lookup(file.decision),
    id: file.decision,
    events: start.events,
    run: start.run,
    now: start.now,
    asked: start.asked(file.decision),
    issued: start.issued,
  });
  if (!derived.ok) return derived;
  const scope = derived.scope;
  const status = scopeStatus(scope, file, start);
  if (!status.active) {
    return {
      ok: false,
      code: /** @type {string} */ (status.code),
      why: /** @type {string} */ (status.why),
    };
  }
  if (!scope.items.includes(start.item)) {
    return {
      ok: false,
      code: 'outside-scope',
      why: `${start.item} is not in the run scope of ${scope.decision} (${scope.items.join(', ')})`,
    };
  }
  if (status.spent + start.estimate > scope.budget_tokens) {
    return {
      ok: false,
      code: 'scope-budget',
      why: `${start.item}'s estimate of ${start.estimate} tokens would pass the run scope's budget: ${status.spent} of ${scope.budget_tokens} spent, ${status.left} left`,
    };
  }
  return { ok: true, scope, spent: status.spent, left: status.left };
}
