// The Claude Code harness adapter (design part 15.4), implementing HarnessAdapter.
//
// Claude Code's own tools (Agent, SendMessage, background Bash, the main session's messages) can
// be called only by the model in the main session, never from Node. So the adapter is a contract:
// for each operation it produces the exact tool call (instructions.mjs), and a driver carries it
// out. On the command line the driver is the orchestrator skill: `hitld dispatch start` prints the
// call, the main session makes it, `hitld dispatch handle` records the harness_ref and
// `hitld dispatch complete` delivers the notification. In tests and evals the driver is simulated.
// Without a driver, an operation that needs the harness throws ContractCall with the instruction.

import { CAPABILITIES } from './capabilities.mjs';
import { followUpInstruction, instructionFor } from './instructions.mjs';
import {
  headlessCompletion,
  reportFromNotification,
  selfReportedTokens,
  sessionRecordCompletion,
  subagentCompletion,
} from './completion.mjs';

/**
 * @typedef {import('../interface.mjs').HarnessAdapter} HarnessAdapter
 * @typedef {import('../interface.mjs').DispatchRequest} DispatchRequest
 * @typedef {import('../interface.mjs').DispatchHandle} DispatchHandle
 * @typedef {import('../interface.mjs').Completion} Completion
 * @typedef {import('./instructions.mjs').Instruction} Instruction
 * @typedef {import('./instructions.mjs').PlaceOptions} PlaceOptions
 *
 * @typedef {object} Driver what carries out a tool call in the main session
 * @property {(call: Instruction) => Promise<string>} start makes the call; resolves to the agent ID or background task ID
 * @property {(call: Instruction) => Promise<void>} [send] a follow-up call
 * @property {(text: string, urgency: string) => Promise<string>} [say] a message to the owner in the main session
 *
 * @typedef {({ kind: 'subagent', text: string, usage?: { tokens?: number | null, toolCalls?: number | null, durationMs?: number | null } | null, commit?: string }
 *   | { kind: 'headless', json: string, stderr?: string, commit?: string }
 *   | { kind: 'session', record: string, text?: string, since?: string | null, commit?: string })
 *   & { report?: string }} Notification
 *   session: an interactive session's completion, from the harness's own record of the session
 *   (`record`); `text` is the report when it came apart from the record (as the chief of staff
 *   relayed it), else the record's last turn is the report. `report`, of any kind: the report as
 *   it rides in the executor's closing commit (`hitld dispatch reconcile`, HITLD-780), which
 *   stands over the one in the harness's record; the record still gives the tokens.
 *   headless `stderr`: the run's errors file, read for a credential that failed (HITLD-880)
 */

export const ID = 'claude-code';
const LEVELS = ['public', 'internal', 'confidential', 'secret'];

export class ContractCall extends Error {
  /** @param {string} message @param {Instruction} instruction */
  constructor(message, instruction) {
    super(message);
    this.name = 'ContractCall';
    this.instruction = instruction;
  }
}

/**
 * Turn a notification into a Completion. What the executor says its own run cost is read from the
 * report and kept apart as a guess (selfReported), never as the completion's tokens (HITLD-438).
 * @param {string} dispatch @param {Notification} n
 * @returns {Completion & import('./completion.mjs').ParsedCompletion & { selfReported: number | null }}
 */
export function completionOf(dispatch, n) {
  const parsed =
    n.kind === 'headless'
      ? headlessCompletion(n.json, n.stderr ?? '')
      : n.kind === 'session'
        ? sessionRecordCompletion(n.record, { since: n.since ?? null })
        : subagentCompletion(n);
  const report =
    typeof n.report === 'string' && n.report.trim()
      ? n.report.trim()
      : n.kind === 'session' && typeof n.text === 'string' && n.text.trim()
        ? reportFromNotification(n.text)
        : parsed.report;
  return {
    ...parsed,
    report,
    selfReported: selfReportedTokens(report),
    ...(n.commit ? { commit: n.commit } : {}),
    dispatch,
  };
}

/**
 * @param {{ driver?: Driver, place?: (request: DispatchRequest) => PlaceOptions,
 *   quietHours?: () => boolean }} [options]
 * @returns {HarnessAdapter & { deliver: (dispatch: string, n: Notification) => void,
 *   instructionFor: typeof instructionFor, held: () => { text: string, urgency: string }[] }}
 */
export function createClaudeCodeAdapter(options = {}) {
  const driver = options.driver;
  /** @type {Map<string, { promise: Promise<Completion>, resolve: (c: Completion) => void }>} */
  const waiting = new Map();
  /** @type {{ text: string, urgency: string }[]} */
  const held = [];
  let refs = 0;

  /** @param {string} dispatch */
  const slot = (dispatch) => {
    let s = waiting.get(dispatch);
    if (!s) {
      /** @type {(c: Completion) => void} */
      let resolve = () => {};
      const promise = new Promise((r) => (resolve = /** @type {any} */ (r)));
      s = { promise, resolve };
      waiting.set(dispatch, s);
    }
    return s;
  };

  /** @param {string} text @param {string} urgency */
  const message = async (text, urgency) => {
    // One signal end to end: interrupts and pages go to the main session at once (quiet hours hold all but pages,
    // which only a sev-1 sends); digest items wait for a merge-batch boundary or the owner's next message.
    if (urgency === 'digest' || (urgency === 'interrupt' && options.quietHours?.())) {
      held.push({ text, urgency });
      return { channel: 'main-session', ref: `held-${++refs}` };
    }
    if (!driver?.say) {
      throw new ContractCall('tell the owner in the main session', {
        tool: 'say',
        input: { text, urgency },
      });
    }
    return { channel: 'main-session', ref: await driver.say(text, urgency) };
  };

  return {
    id: ID,
    capabilities: () => ({ ...CAPABILITIES }),
    instructionFor,
    async dispatch(request) {
      if (
        LEVELS.indexOf(request.classification) > LEVELS.indexOf(CAPABILITIES.max_classification)
      ) {
        throw new Error(
          `${request.item} is ${request.classification}: no agent is given ${request.classification} material`,
        );
      }
      const call = instructionFor(request, options.place?.(request));
      if (!driver)
        throw new ContractCall(
          `make this ${call.tool} call in the main session, then run hitld dispatch handle`,
          call,
        );
      slot(request.dispatch);
      const ref = await driver.start(call);
      return { dispatch: request.dispatch, harness: ID, ref };
    },
    async onComplete(handle) {
      return slot(handle.dispatch).promise;
    },
    deliver(dispatch, n) {
      slot(dispatch).resolve(completionOf(dispatch, n));
    },
    async followUp(handle, text) {
      const call = followUpInstruction({
        harnessRef: handle.ref,
        message: text,
        tier: 1,
        dispatch: handle.dispatch,
      });
      if (!driver?.send)
        throw new ContractCall('make this SendMessage call in the main session', call);
      waiting.delete(handle.dispatch);
      slot(handle.dispatch);
      await driver.send(call);
    },
    async ask(question) {
      return message(question.text, 'interrupt');
    },
    async notify(m, urgency) {
      return message(m.text, urgency);
    },
    held: () => [...held],
  };
}
