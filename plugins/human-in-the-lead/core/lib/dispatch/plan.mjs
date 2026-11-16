// The dispatch plan (design parts 5.2 and 15.3): which ready items start now, within the
// concurrency cap, the serial resources, the harness's capabilities, the disk floor and the quota
// gate. Pure: the
// caller passes what is in flight, which locks other holders have, and the gate.
//
// The plan only chooses. Starting is `hitld dispatch start`, one item at a time, which records the
// dispatch in the ledger before the harness is asked.

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
 *   setup?: { done: boolean, reason?: string | null, byHand?: string },
 *   disk?: { state: string, reason: string },
 *   touches?: (item: Item) => import('./touches.mjs').Touches,
 *   executorModes?: (item: Item) => ModeAbility,
 * }} r
 *   setup: until the first-run setup is done (design part 13.4), every item waits (reason
 *   `setup`) and the cap is one, except `byHand`, the one item the person started by hand
 *   touches: an item's touches for the overlap rule (touches.mjs: its own, else derived); by
 *   default its own
 *   executorModes: which ways of running the item's executor can run the contract's commands
 *   (permissions.mjs). A tier-3 item whose headless runs cannot runs interactive, and the other
 *   way round; when neither can, or a subagent cannot below tier 3, it is held (reason
 *   executor-permissions) and nothing is launched
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
  if (setupWait) {
    cap = Math.min(cap, 1);
    notes.push('setup not done: conservative defaults apply (one executor, the default reserve)');
  }
  /** @type {Planned[]} */
  const start = [];
  /** @type {Planned[]} */
  const inline = [];
  /** @type {Held[]} */
  const held = [];
  const busy = new Set(r.running.flatMap((d) => d.serial_resources));
  const runningTouches = r.running.flatMap((d) => d.touches ?? []);
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
      held.push({
        item: id,
        reason: 'serial',
        why: `${taken} is held by a running or planned dispatch`,
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
    if (r.running.length + start.length >= cap) {
      waiting++;
      continue;
    }
    /** @type {string[]} */
    const itemNotes = [];
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
    for (const s of serial) busy.add(s);
    runningTouches.push(...touches.touches);
  }

  return {
    cap,
    running: r.running.length,
    free: Math.max(0, cap - r.running.length - start.length),
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
    notes,
  };
}
