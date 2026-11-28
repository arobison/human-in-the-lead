// The dispatch plan (design parts 5.2 and 15.3): which ready items start now, within the
// concurrency cap, the serial resources, the harness's capabilities, the disk floor and the quota
// gate. Pure: the
// caller passes what is in flight, which locks other holders have, and the gate.
//
// The plan only chooses. Starting is `hitld dispatch start`, one item at a time, which records the
// dispatch in the ledger before the harness is asked. The start list is advice: slots, serial
// resources and overlap are taken only by dispatches that run, never by what the plan proposes,
// so any ready item that is not held may start while a slot is free (HITLD-153).

import { effectiveEvents } from '../ledger/summary.mjs';
import { overlapShare } from './item.mjs';
import { CONTRACT_COMMANDS, PERMISSIONS_REASON } from './permissions.mjs';

/**
 * @typedef {import('./item.mjs').Item} Item
 * @typedef {import('./sizing.mjs').Sizing} Sizing
 * @typedef {import('../../harness/interface.mjs').HarnessCapabilities} HarnessCapabilities
 *
 * @typedef {object} RunningEntry what the plan needs of one in-flight dispatch
 * @property {string} dispatch
 * @property {string} item
 * @property {string[]} serial_resources
 * @property {string[]} [touches]
 *
 * @typedef {{ mode: string, allow: boolean, reason: string, notify_owner?: boolean, ask_owner?: boolean,
 *   economize?: { reduce_concurrency: boolean }, resets_at?: string | null }} GateAnswer
 *
 * @typedef {object} Planned
 * @property {string} item
 * @property {0 | 1 | 2 | 3} tier as it will run, after degrading for the harness
 * @property {Sizing} sizing
 * @property {string[]} serial
 * @property {import('./touches.mjs').Touches} touches what the overlap rule used
 * @property {string[]} notes degradations and the like
 * @property {'headless' | 'interactive'} [mode] for tier 3, when the plan chose it: the other mode
 *   cannot run the contract's commands
 * @property {Record<'headless' | 'interactive', 'able' | 'unable' | 'unknown'>} [modes] for tier 3:
 *   whether each mode can run the contract's commands, as far as the plan knows
 *
 * @typedef {{ item: string, reason: string, why: string }} Held
 *
 * @typedef {import('./permissions.mjs').ExecutorMode} ExecutorMode
 * @typedef {Partial<Record<ExecutorMode, { able: boolean, why: string }>>} ModeAbility whether each
 *   way of running an executor can run the contract's commands; a mode left out is not known
 */

const LEVELS = ['public', 'internal', 'confidential', 'secret'];

/** The reason a start the merge backlog holds carries (dispatch/backlog.mjs). */
export const BACKLOG_REASON = 'merge-backlog';

/**
 * `queue` holds the ready items in priority order; `cap` is the run's concurrency cap;
 * `heldElsewhere` names the holder of a machine lock another holder has, or null.
 * @param {{
 *   queue: Item[],
 *   sizes: Map<string, Sizing>,
 *   running: RunningEntry[],
 *   cap: number,
 *   capabilities: HarnessCapabilities,
 *   gate: (item: Item) => GateAnswer,
 *   heldElsewhere?: (resource: string) => string | null,
 *   machine?: { has: (name: string) => boolean, why: (name: string) => string },
 *   overlapSerialize?: number,
 *   critical?: Set<string>,
 *   setup?: { done: boolean, reason?: string | null, byHand?: string, conservative?: string | null },
 *   disk?: { state: string, reason: string },
 *   touches?: (item: Item) => import('./touches.mjs').Touches,
 *   executorModes?: (item: Item) => ModeAbility,
 *   mergeFix?: boolean,
 *   backlog?: { hold: boolean, why: string },
 * }} r
 *   setup: until the first-run setup is done (design part 13.4), every item waits (reason
 *   `setup`) and the cap is one, except `byHand`, the one item the person started by hand
 *   touches: an item's touches for the overlap rule (touches.mjs: its own, else derived); by
 *   default its own
 *   executorModes: which ways of running the item's executor can run the contract's commands
 *   (permissions.mjs). A tier-3 item whose headless runs cannot runs interactive, and the other
 *   way round; when neither can, or a subagent cannot below tier 3, it is held (reason
 *   executor-permissions) and nothing is launched
 *   mergeFix: the queue is one item whose work unsticks a merge the queue cannot make (HITLD-978).
 *   With every slot taken it may take one past the cap, so a run the cap holds to one slot (the
 *   quota gate's economize mode, a setup not done) cannot deadlock behind branches waiting to
 *   merge. One past only: a second fix waits for a slot as any item does. A harness that runs one
 *   executor at a time gives no slot past it
 *   backlog: the merge backlog's hold (backlog.mjs): with one full batch of finished branches
 *   waiting on the merge queue, every dispatched start is held (reason merge-backlog), except the
 *   one item that fixes a stuck merge; tier-0 work, done inline, is not a start and goes on
 */
export function planDispatch(r) {
  const caps = r.capabilities;
  /** @type {string[]} */
  const notes = [];
  let cap = r.cap;
  if (!caps.parallel_subagents && cap > 1) {
    cap = 1;
    notes.push('the harness runs one executor at a time: the cap is pinned at 1');
  }
  const setupWait = r.setup && !r.setup.done ? r.setup : null;
  // Below the machine's disk floor nothing new starts, inline work included (machine/disk.mjs).
  const diskFull = r.disk?.state === 'below' ? r.disk : null;
  const backlogHold = r.backlog?.hold && !r.mergeFix ? r.backlog : null;
  if (backlogHold) notes.push(`starts hold for the merge backlog: ${backlogHold.why}`);
  if (setupWait) {
    cap = Math.min(cap, 1);
    notes.push('setup not done: conservative defaults apply (one executor, the default reserve)');
  } else if (r.setup?.conservative) {
    // The person settings were expected from the store and could not be read (HITLD-148): the
    // run goes on, at one executor, and says why.
    cap = Math.min(cap, 1);
    notes.push(r.setup.conservative);
  }
  /** @type {Planned[]} */
  const start = [];
  /** @type {Planned[]} */
  const inline = [];
  /** @type {Held[]} */
  const held = [];
  /** @type {{ item: string, with: string[], why: string }[]} proposals that overlap one before them */
  const notTogether = [];
  // What running dispatches hold: an item they block is held. What the start list proposes holds
  // nothing: an item that would clash with a proposal waits behind it, and may start instead.
  const busy = new Set(r.running.flatMap((d) => d.serial_resources));
  const runningTouches = r.running.flatMap((d) => d.touches ?? []);
  /** @type {Set<string>} */
  const proposedSerial = new Set();
  /** @type {string[]} */
  const proposedTouches = [];
  let gateMode = 'normal';
  /** @type {GateAnswer | null} */
  let lastGate = null;
  let economized = false;
  let waiting = 0;
  /** @param {Item} item @returns {import('./touches.mjs').Touches} */
  const touchesOf =
    r.touches ??
    ((item) => {
      const own = /** @type {string[]} */ (item.touches ?? []);
      return { touches: own, source: own.length ? 'item' : 'none' };
    });

  for (const item of r.queue) {
    const id = String(item.id);
    const sizing = /** @type {Sizing} */ (r.sizes.get(id));
    if (setupWait && id !== setupWait.byHand) {
      held.push({
        item: id,
        reason: 'setup',
        why: setupWait.reason ?? 'setup not done: run the first-run setup',
      });
      continue;
    }
    if (diskFull) {
      held.push({ item: id, reason: 'disk', why: diskFull.reason });
      continue;
    }
    if (sizing.tier === 0) {
      inline.push({
        item: id,
        tier: 0,
        sizing,
        serial: [],
        touches: touchesOf(item),
        notes: ['the orchestrator does it inline, through the merge queue as a tier-0 branch'],
      });
      continue;
    }
    if (backlogHold) {
      held.push({ item: id, reason: BACKLOG_REASON, why: backlogHold.why });
      continue;
    }
    const level = LEVELS.indexOf(String(item.classification ?? 'internal'));
    if (level > LEVELS.indexOf(caps.max_classification)) {
      held.push({
        item: id,
        reason: 'classification',
        why: `${item.classification} is above what this harness may process (${caps.max_classification})`,
      });
      continue;
    }
    if (caps.hooks !== 'full' && level > 0) {
      held.push({
        item: id,
        reason: 'classification',
        why: 'without full hooks the guard catches only after the fact, so only public items go to this harness',
      });
      continue;
    }
    // An item needs resources this machine may lack (design part 13.4): it waits, with the reason.
    const lacking = r.machine
      ? /** @type {string[]} */ (item.resources ?? []).find((n) => !r.machine?.has(n))
      : undefined;
    if (lacking !== undefined) {
      held.push({ item: id, reason: 'resource', why: `waits: ${r.machine?.why(lacking)}` });
      continue;
    }
    const modes = r.executorModes?.(item) ?? {};
    const tier3 = sizing.tier === 3 && caps.persistent_sessions;
    /** @type {'headless' | 'interactive' | undefined} */
    let mode;
    /** @type {string | null} */
    let modeNote = null;
    if (tier3) {
      const { headless, interactive } = modes;
      if (headless?.able === false && interactive?.able === false) {
        held.push({
          item: id,
          reason: PERMISSIONS_REASON,
          why: `neither tier-3 mode can run ${CONTRACT_COMMANDS.join(', ')}: ${headless.why}; ${interactive.why}`,
        });
        continue;
      }
      if (headless?.able === false) {
        mode = 'interactive';
        modeNote = `headless runs here cannot run the contract's commands (${headless.why}): it runs interactive`;
      } else if (interactive?.able === false) {
        mode = 'headless';
        modeNote = `interactive sessions here cannot run the contract's commands (${interactive.why}): it runs headless`;
      }
    } else if (sizing.tier > 0 && modes.subagent?.able === false) {
      held.push({
        item: id,
        reason: PERMISSIONS_REASON,
        why: `a subagent here cannot run ${CONTRACT_COMMANDS.join(', ')}: ${modes.subagent.why}`,
      });
      continue;
    }
    const gate = r.gate(item);
    lastGate = gate;
    gateMode = gate.mode;
    if (!economized && gate.economize?.reduce_concurrency && cap > 1) {
      cap -= 1;
      economized = true;
      notes.push(`the quota gate says ${gate.mode}: one slot fewer`);
    }
    if (!gate.allow) {
      held.push({ item: id, reason: 'quota', why: gate.reason });
      continue;
    }
    const serial = /** @type {string[]} */ (item.serial ?? []);
    const taken = serial.find((s) => busy.has(s));
    if (taken) {
      const holder = r.running.find((d) => d.serial_resources.includes(taken));
      held.push({
        item: id,
        reason: 'serial',
        why: `${taken} is held by a running dispatch${holder ? ` (${holder.dispatch} on ${holder.item})` : ''}`,
      });
      continue;
    }
    const elsewhere = serial.map((s) => [s, r.heldElsewhere?.(s) ?? null]).find(([, h]) => h);
    if (elsewhere) {
      held.push({
        item: id,
        reason: 'serial',
        why: `${elsewhere[0]} is locked by ${elsewhere[1]} on this machine`,
      });
      continue;
    }
    const touches = touchesOf(item);
    const share = overlapShare(touches.touches, runningTouches);
    if (share >= (r.overlapSerialize ?? 0.5)) {
      held.push({
        item: id,
        reason: 'overlap',
        why: `${Math.round(share * 100)}% of its touches overlap running work`,
      });
      continue;
    }
    const past = r.mergeFix && caps.parallel_subagents ? 1 : 0;
    if (
      r.running.length + start.length >= cap + past ||
      serial.some((s) => proposedSerial.has(s))
    ) {
      waiting++;
      continue;
    }
    // Two proposals whose touches overlap are not offered together (HITLD-995): the one the queue
    // puts later waits, and the plan says why. A proposal holds nothing (HITLD-153), so it waits
    // rather than being held: started alone, it may start.
    const proposedShare = overlapShare(touches.touches, proposedTouches);
    if (proposedTouches.length && proposedShare >= (r.overlapSerialize ?? 0.5)) {
      const others = start
        .filter((p) => overlapShare(touches.touches, p.touches.touches) > 0)
        .map((p) => p.item);
      notTogether.push({
        item: id,
        with: others,
        why: `${Math.round(proposedShare * 100)}% of its touches overlap ${others.join(', ')}, proposed in this plan (dispatch.serialize_overlap_share ${r.overlapSerialize ?? 0.5}): it waits for a later plan`,
      });
      waiting++;
      continue;
    }
    /** @type {string[]} */
    const itemNotes = sizing.estimate_note ? [sizing.estimate_note] : [];
    if (r.running.length + start.length >= cap) {
      itemNotes.push(
        `it fixes a stuck merge: it takes a slot past the cap of ${cap}, which frees when it reports or is abandoned`,
      );
    }
    let tier = sizing.tier;
    if (tier === 3 && !caps.persistent_sessions) {
      tier = 2;
      itemNotes.push(
        'no separate sessions here: tier 3 runs as tier 2 at the highest model and effort, with a smaller slice of the item',
      );
    }
    /** @type {Planned} */
    const planned = { item: id, tier, sizing, serial, touches, notes: itemNotes };
    if (tier === 3) {
      /** @param {{ able: boolean } | undefined} m */
      const state = (m) => (m === undefined ? 'unknown' : m.able ? 'able' : 'unable');
      planned.modes = { headless: state(modes.headless), interactive: state(modes.interactive) };
      if (mode) planned.mode = mode;
      if (modeNote) itemNotes.push(modeNote);
    }
    start.push(planned);
    for (const s of serial) proposedSerial.add(s);
    proposedTouches.push(...touches.touches);
  }

  return {
    cap,
    running: r.running.length,
    // The slots running dispatches leave: the start list is a proposal for them, not a taker.
    free: Math.max(0, cap - r.running.length),
    slots: slotsText(cap, r.running),
    gate: {
      mode: gateMode,
      reason: lastGate?.reason ?? null,
      notify_owner: lastGate?.notify_owner ?? false,
      ask_owner: lastGate?.ask_owner ?? false,
      resets_at: lastGate?.resets_at ?? null,
    },
    start,
    inline,
    held,
    waiting,
    not_together: notTogether,
    notes,
  };
}

/**
 * The slots in words, as the plan prints them and a refused start repeats them: the cap, who holds
 * each slot, how many are free, and, when none is, what frees one.
 * @param {number} cap @param {{ dispatch: string, item: string }[]} running
 */
export function slotsText(cap, running) {
  const free = Math.max(0, cap - running.length);
  const holders = running.map((d) => `${d.dispatch} on ${d.item}`).join(', ');
  const text = `cap ${cap}, ${running.length} running${holders ? ` (${holders})` : ''}, ${free} free`;
  return free > 0 || !running.length
    ? text
    : `${text}: a slot frees when one of them reports or is abandoned`;
}

/**
 * @typedef {object} AwaitingMerge an item whose dispatch reported its work done on a branch that
 *   has not merged: it is not ready, takes no slot, and is not planned again until the branch
 *   merges or is reverted, or its dispatch is abandoned (HITLD-153)
 * @property {string} item
 * @property {string | null} dispatch the dispatch that reported the work
 * @property {string} branch
 * @property {string} since when the work was verified and queued to merge
 * @property {string} verified the ID of that `verified` event: a correction of it releases the item
 * @property {boolean} sent_back the merge queue sent the branch back: it waits for the follow-up
 */

/**
 * The items awaiting merge, from the ledger as corrected: a `verified` pass with a branch queues an
 * item's work to merge; `merged`, `reverted`, `abandoned` and `unclaimed` for the item end the
 * wait, and the tracker decides again. A `verified` fail keeps the wait: the merge queue sends the
 * branch back to the same executor as a follow-up, which a fresh dispatch would duplicate. A
 * correction of a pass (a `verified` fail with `corrects` naming it) releases the item: the owner
 * dropped the branch.
 * @param {import('../ledger/ledger.mjs').LedgerEntry[]} events
 * @returns {AwaitingMerge[]}
 */
export function awaitingMerge(events) {
  return foldAwaiting(events, true);
}

/**
 * The branches still queued to merge whatever became of the dispatches on their items: as
 * awaitingMerge, but an `abandoned` or `unclaimed` event ends no wait. Abandoning a dispatch frees
 * its slot, not its branch: a branch that closed its item and was queued stays queued until it
 * merges, is reverted or its pass is corrected, so planning the item again would do the work twice
 * (HITLD-978). The caller keeps only those whose branch still carries the item's close.
 * @param {import('../ledger/ledger.mjs').LedgerEntry[]} events
 * @returns {AwaitingMerge[]}
 */
export function queuedBranches(events) {
  return foldAwaiting(events, false);
}

/**
 * @param {import('../ledger/ledger.mjs').LedgerEntry[]} events
 * @param {boolean} abandonEnds whether `abandoned` and `unclaimed` end a wait
 * @returns {AwaitingMerge[]}
 */
function foldAwaiting(events, abandonEnds) {
  /** @type {Map<string, AwaitingMerge>} */
  const waiting = new Map();
  /** @type {Map<string, string>} the dispatch that last reported on each item */
  const reported = new Map();
  const ends = abandonEnds
    ? ['merged', 'reverted', 'abandoned', 'unclaimed']
    : ['merged', 'reverted'];
  for (const e of effectiveEvents(events)) {
    const item = e.item;
    if (typeof item !== 'string') continue;
    if (e.event === 'reported' && typeof e.dispatch === 'string') reported.set(item, e.dispatch);
    if (e.event === 'verified' && e.result === 'pass' && typeof e.branch === 'string') {
      waiting.set(item, {
        item,
        dispatch: typeof e.dispatch === 'string' ? e.dispatch : (reported.get(item) ?? null),
        branch: e.branch,
        since: typeof e.at === 'string' ? e.at : '',
        verified: String(e.id),
        sent_back: false,
      });
    } else if (e.event === 'verified' && e.result === 'fail' && e.corrects !== undefined) {
      waiting.delete(item);
    } else if (e.event === 'verified' && e.result === 'fail') {
      const w = waiting.get(item);
      if (w) w.sent_back = true;
    } else if (ends.includes(e.event)) {
      waiting.delete(item);
    }
  }
  return [...waiting.values()];
}
