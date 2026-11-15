// The harness adapter interface (design part 15.3).
//
// The core never calls a harness. It knows only this interface: an adapter dispatches executors,
// delivers their completions and reaches the human in one harness. Adding a harness means
// writing an adapter under core/harness/<id>/ and its packaging; never a change to the core.
//
// Methods return promises, since every real harness is asynchronous.

import { schemas } from '../lib/schema/registry.mjs';

/**
 * @typedef {'public' | 'internal' | 'confidential' | 'secret'} Classification
 *
 * @typedef {object} HarnessCapabilities
 * @property {boolean} parallel_subagents several executors at once under one orchestrator
 * @property {boolean} persistent_sessions a separate long-running session (tier 3)
 * @property {boolean} worktrees an isolated checkout per executor
 * @property {boolean} background_completion completion arrives as an event, without polling
 * @property {boolean} remote_human_channel the human can answer away from the machine
 * @property {'full' | 'subset' | 'none'} hooks lifecycle hooks such as pre-tool-use
 * @property {boolean} model_selection
 * @property {boolean} effort_selection
 * @property {'tokens' | 'requests' | 'none'} usage_reporting
 * @property {Classification} max_classification the highest level it may process
 *
 * @typedef {object} DispatchRequest
 * @property {string} dispatch the dispatch ID, D-<n>
 * @property {string} item the tracker ID
 * @property {string} brief the brief text (design part 5.2)
 * @property {0 | 1 | 2 | 3} tier
 * @property {string} role executor, acceptance, adversary, reviewer, ...
 * @property {string} [model] as the harness names it, after mapping the tier's model class
 * @property {string} [effort]
 * @property {'worktree' | 'none'} isolation
 * @property {string} [branch] <branch_prefix>/<ID>-<slug>
 * @property {number} [budgetTokens] the report-by budget
 * @property {Classification} classification the item's, so the adapter can refuse what it may not process
 *
 * @typedef {object} DispatchHandle
 * @property {string} dispatch
 * @property {string} harness the adapter ID
 * @property {string} ref the harness's own reference: an agent ID, a process ID, a task URL
 *
 * @typedef {object} Usage
 * @property {number | null} tokens
 * @property {number | null} toolCalls
 * @property {number | null} durationMs
 *
 * @typedef {object} Completion
 * @property {string} dispatch
 * @property {string} report the executor's final message, in the report shape (design part 5.6)
 * @property {string} [commit] the branch's final commit
 * @property {Usage | null} usage null when the harness does not report usage
 *
 * @typedef {object} DecisionQuestion
 * @property {string} decision the decision item's ID
 * @property {string} text the stand-alone question (design part 4.2)
 * @property {Classification} classification
 *
 * @typedef {object} Message
 * @property {string} text
 * @property {Classification} classification
 *
 * @typedef {'interrupt' | 'digest' | 'page'} Urgency
 *
 * @typedef {object} MessageRef
 * @property {string} channel
 * @property {string} ref
 *
 * @typedef {object} HarnessAdapter
 * @property {string} id 'claude-code', 'copilot-vscode', 'copilot-cloud', 'codex', 'fake', ...
 * @property {() => HarnessCapabilities} capabilities
 * @property {(d: DispatchRequest) => Promise<DispatchHandle>} dispatch
 * @property {(h: DispatchHandle) => Promise<Completion>} onComplete resolves when the executor finishes
 * @property {(h: DispatchHandle, message: string) => Promise<void>} followUp continue the same agent with its context
 * @property {(q: DecisionQuestion) => Promise<MessageRef>} ask put a question to the human
 * @property {(m: Message, urgency: Urgency) => Promise<MessageRef>} notify
 */

export const ADAPTER_METHODS = Object.freeze([
  'capabilities',
  'dispatch',
  'onComplete',
  'followUp',
  'ask',
  'notify',
]);

/**
 * Check that an object implements the interface and declares valid capabilities.
 * @param {unknown} adapter
 * @returns {string[]} problems; empty when the adapter is usable
 */
export function checkHarnessAdapter(adapter) {
  if (typeof adapter !== 'object' || adapter === null) return ['adapter must be an object'];
  const a = /** @type {Record<string, unknown>} */ (adapter);
  /** @type {string[]} */
  const problems = [];
  if (typeof a.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(a.id)) {
    problems.push('id must be a lower-case name such as "claude-code"');
  }
  for (const m of ADAPTER_METHODS) {
    if (typeof a[m] !== 'function') problems.push(`${m} must be a function`);
  }
  if (typeof a.capabilities === 'function') {
    const errors = schemas().validate('harness-capabilities', a.capabilities());
    problems.push(...errors.map((e) => `capabilities: ${e.path} ${e.message}`));
  }
  return problems;
}
