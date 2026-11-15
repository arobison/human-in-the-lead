// The open decisions, in the order of what waiting costs, with the attention budget left and where
// each one goes (design part 2, "The owner's attention as a budget"); and the sweep that applies
// the defaults that are due.
//
// `pendingDecisions` reads the tracker (what each decision blocks), the private store (the
// question as it was asked, and the ledger: what was shown, how, and answered) and the settings,
// and gives them to the gate in budget.mjs. It changes nothing. `sweepDefaults` applies what the
// gate marks `default`: the answer is recorded with `answered_via: default`, the decision is
// closed, the ledger says `answered` with `via: default` and the trust record `default`, so the
// digest lists it and the owner can reverse it.
//
// A default is read from the ask record in the private store, never from the decision item: the
// item's fields can be edited by anyone with tracker access, and a default that is applied is a
// call made without the owner.

import { readLedger } from '../ledger/ledger.mjs';
import { inflight } from '../ledger/inflight.mjs';
import { decisionLives, recordDecisionEvent } from './attention.mjs';
import { deliveryGate } from './budget.mjs';
import { describeOption, optionIndex } from './format.mjs';
import { OPEN_STATES, askedKey } from './flow.mjs';
import { UNASSIGNED, readTrustEvents, recordTrustEvent } from './trust.mjs';
import { decisionUrgency, readyWork } from './urgency.mjs';

/**
 * @typedef {import('./flow.mjs').Deps} Deps
 * @typedef {import('./flow.mjs').AskedRecord} AskedRecord
 * @typedef {import('../settings/attention.mjs').AttentionSettings} AttentionSettings
 * @typedef {{ attention: AttentionSettings, cap: number }} Settings the person's effective
 *   attention budget and the executor cap
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const GRAPH_STATES = ['proposed', 'planned', 'in-progress'];

/** @param {Deps} deps */
const nowOf = (deps) => (deps.now ?? (() => new Date().toISOString()))();

/**
 * @param {Deps} deps @param {string} id
 * @returns {AskedRecord | null}
 */
function askedRecord(deps, id) {
  const text = deps.store.read(askedKey(id));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The open decisions, each with where it goes, and the budget left.
 * @param {Deps} deps @param {Settings} settings
 * @returns {{ ok: boolean, at: string, open: number } & import('./budget.mjs').GateResult}
 */
export function pendingDecisions(deps, settings) {
  const now = Date.parse(nowOf(deps));
  const items = deps.tracker.query({ state: /** @type {any} */ (GRAPH_STATES) });
  const urgency = decisionUrgency(items);
  const lives = decisionLives(deps.store);
  const running = inflight(readLedger(deps.store).events);
  const ready = readyWork(
    items,
    running.map((d) => d.item),
  );
  const open = items.filter(
    (i) => i.kind === 'decision' && OPEN_STATES.includes(/** @type {string} */ (i.state)),
  );

  const candidates = open.map((d) => {
    const id = String(d.id);
    const asked = askedRecord(deps, id);
    const life = lives.get(id);
    const u = urgency.get(id) ?? {
      blocks: [],
      unblocks_ready: [],
      critical_path: false,
      cost_of_delay: 0,
    };
    return {
      id,
      title: String(d.title ?? id),
      asked_at: life?.asked ?? null,
      sent_at: life?.sent ?? null,
      reversibility: asked?.reversibility ?? null,
      default_if_unanswered: asked?.default_if_unanswered ?? null,
      recommended: asked?.recommendation?.option ?? null,
      ...u,
    };
  });

  let interruptsUsed = 0;
  let lastAnsweredAt = /** @type {string | null} */ (null);
  for (const life of lives.values()) {
    if (life.delivery === 'interrupt' && life.sent && now - Date.parse(life.sent) < DAY_MS) {
      interruptsUsed++;
    }
    if (life.answered && life.via === null && (!lastAnsweredAt || life.answered > lastAnsweredAt)) {
      lastAnsweredAt = life.answered;
    }
  }
  const nonUrgentSent = candidates.filter(
    (c) => c.sent_at !== null && lives.get(c.id)?.delivery === 'interrupt',
  ).length;

  const gate = deliveryGate(candidates, {
    now,
    attention: settings.attention,
    slots: { cap: settings.cap, in_flight: running.length, ready: ready.length },
    interruptsUsed,
    nonUrgentSent,
    lastAnsweredAt,
  });
  return { ok: true, at: new Date(now).toISOString(), open: open.length, ...gate };
}

/**
 * The text a default records as the answer.
 * @param {AskedRecord} asked @param {string} option @param {string} why
 */
function defaultAnswer(asked, option, why) {
  const i = optionIndex({ options: asked.options ?? [] }, option);
  const chosen = i === null ? option : describeOption(/** @type {any} */ (asked.options)[i], i);
  return `Default applied (${why}): ${chosen}`;
}

/**
 * Apply the defaults that are due: the answer is recorded as given by default, the decision is
 * closed, and the application is in the ledger and the trust record for the digest. A decision
 * that is no longer open, or has no ask record, is skipped and said so.
 * @param {Deps} deps @param {Settings} settings
 * @returns {{ ok: boolean } & Record<string, any>}
 */
export function sweepDefaults(deps, settings) {
  const pending = pendingDecisions(deps, settings);
  const due = /** @type {Record<string, any>[]} */ (pending.decisions).filter(
    (d) => d.deliver === 'default',
  );
  /** @type {Record<string, any>[]} */
  const applied = [];
  /** @type {{ decision: string, why: string }[]} */
  const skipped = [];
  for (const d of due) {
    const id = String(d.decision);
    const asked = askedRecord(deps, id);
    if (!asked) {
      skipped.push({
        decision: id,
        why: 'it has no record of how it was asked, so no default is applied',
      });
      continue;
    }
    try {
      const entity = deps.tracker.get(id);
      if (
        entity.kind !== 'decision' ||
        !OPEN_STATES.includes(/** @type {string} */ (entity.state))
      ) {
        skipped.push({ decision: id, why: `it is ${entity.state}, not open` });
        continue;
      }
      const at = nowOf(deps);
      const why =
        d.default.source === 'recommendation'
          ? 'the digest was full and it is easy to undo, so it took the recommendation'
          : `no answer by ${d.default.deadline}`;
      const answer = defaultAnswer(asked, d.default.option, why);
      const version = /** @type {string} */ (entity._version ?? entity.version);
      deps.tracker.update(id, { answer, answered_at: at, answered_via: 'default' }, version);
      deps.tracker.transition(id, 'done', 'a default was applied', {});
      recordDecisionEvent(deps.store, 'asked', id, at);
      recordDecisionEvent(deps.store, 'answered', id, at, { via: 'default' });
      recordTrustEvent(
        deps.store,
        {
          kind: 'default',
          area: entity.area ?? asked.area ?? UNASSIGNED,
          subject: id,
          ...(entity.decider ? { decider: entity.decider } : {}),
          ...((entity.rights_basis ?? asked.basis)
            ? { basis: entity.rights_basis ?? asked.basis }
            : {}),
        },
        at,
      );
      applied.push({
        decision: id,
        option: d.default.option,
        source: d.default.source,
        answer,
        reason: d.reason,
        reverse_with: `hitld rights reverse ${id}`,
      });
    } catch (e) {
      skipped.push({ decision: id, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok: true, applied, skipped, budget: pending.budget };
}

/**
 * The decisions that took their default, for the digest: each with whether the owner has since
 * reversed it, and the command that reverses it.
 * @param {Deps} deps @param {{ since?: string | null }} [filter] since: only those after it
 */
export function listDefaults(deps, filter = {}) {
  const reversed = new Set(
    readTrustEvents(deps.store)
      .filter((e) => e.kind === 'reversal' && e.subject_kind === 'default')
      .map((e) => e.subject),
  );
  return deps.tracker
    .query({ kind: 'decision', state: 'done' })
    .filter((d) => d.answered_via === 'default')
    .filter((d) => !filter.since || String(d.answered_at) > filter.since)
    .map((d) => ({
      decision: d.id,
      title: d.title,
      answer: d.answer,
      at: d.answered_at,
      area: d.area ?? UNASSIGNED,
      reversed: reversed.has(String(d.id)),
      ...(reversed.has(String(d.id)) ? {} : { reverse_with: `hitld rights reverse ${d.id}` }),
    }));
}
