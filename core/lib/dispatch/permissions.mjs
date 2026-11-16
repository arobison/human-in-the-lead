// Executors that cannot run the contract's commands (HITLD-141). The contract needs an executor to
// run hitld, node, npm and git. A harness whose permission mode refuses them leaves the executor
// unable to claim, commit or close: its report shows the refused commands. That report is recorded
// as blocked by permissions (reason executor-permissions), and the plan does not dispatch the item
// into the same refusal again in the same run: it uses the other tier-3 mode, or holds the item.

/** The commands the contract requires an executor to run. */
export const CONTRACT_COMMANDS = Object.freeze(['hitld', 'node', 'npm', 'git']);

/** The reason a permission-blocked report and the plan's hold carry. */
export const PERMISSIONS_REASON = 'executor-permissions';

/** @typedef {'headless' | 'interactive' | 'subagent'} ExecutorMode */

const REFUSAL = /\b(?:denied|refused|not (?:permitted|allowed)|permission)/i;
const COMMAND = new RegExp(`(?<![\\w./-])(${CONTRACT_COMMANDS.join('|')})(?![\\w-])`, 'g');

/**
 * The contract command a shell command line starts with, past environment assignments
 * (`HITLD_DISPATCH=D-1 node core/bin/hitld.mjs ...` is node), or null.
 * @param {unknown} command
 */
function leadingCommand(command) {
  if (typeof command !== 'string') return null;
  const words = command.trim().split(/\s+/);
  const first = words.find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? '';
  const name = first.split('/').pop() ?? '';
  return CONTRACT_COMMANDS.includes(name) ? name : null;
}

/**
 * The contract commands a completion shows refused, in CONTRACT_COMMANDS order; empty when none.
 * Two kinds of evidence:
 * - `denials`: a headless run's permission_denials (each with tool_name and tool_input), a Bash
 *   call whose command line starts with a contract command;
 * - the report text: a line naming a contract command and a refusal (denied, refused, not
 *   permitted, not allowed, permission). A report in the fixed shape whose result is done is
 *   never read this way: it ran the commands.
 * @param {{ report: string, denials?: unknown, done?: boolean }} r
 * @returns {string[]}
 */
export function refusedCommands(r) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const d of Array.isArray(r.denials) ? r.denials : []) {
    const tool = d && typeof d === 'object' ? /** @type {any} */ (d).tool_name : null;
    if (tool !== 'Bash') continue;
    const name = leadingCommand(/** @type {any} */ (d).tool_input?.command);
    if (name) found.add(name);
  }
  if (!r.done) {
    for (const line of String(r.report ?? '').split('\n')) {
      if (!REFUSAL.test(line)) continue;
      for (const m of line.matchAll(COMMAND)) found.add(m[1]);
    }
  }
  return CONTRACT_COMMANDS.filter((c) => found.has(c));
}

/**
 * How a dispatch ran, from its dispatched event: its tier-3 mode, or a subagent below tier 3.
 * @param {Record<string, any> | undefined} dispatched
 * @returns {ExecutorMode}
 */
export const modeOf = (dispatched) =>
  dispatched?.mode === 'headless' || dispatched?.mode === 'interactive'
    ? dispatched.mode
    : 'subagent';

/**
 * For each item, the modes a report in this run showed refused, with why: the dispatch and the
 * commands it was refused. Only the run `runId` counts; a new run starts without them.
 * @param {Record<string, any>[]} events the ledger
 * @param {string | null | undefined} runId
 * @returns {Map<string, Partial<Record<ExecutorMode, string>>>}
 */
export function refusalsInRun(events, runId) {
  /** @type {Map<string, Record<string, any>>} */
  const dispatched = new Map();
  /** @type {Map<string, Partial<Record<ExecutorMode, string>>>} */
  const out = new Map();
  if (!runId) return out;
  for (const e of events) {
    if (e.event === 'dispatched') dispatched.set(e.dispatch, e);
    if (e.event !== 'reported' || e.reason !== PERMISSIONS_REASON || e.run !== runId) continue;
    const mode = modeOf(dispatched.get(e.dispatch));
    const entry = out.get(e.item) ?? {};
    const how = mode === 'subagent' ? 'as a subagent' : mode;
    entry[mode] =
      `${e.dispatch} ran ${how} and its permission mode ${String(e.notes ?? 'refused the contract commands').split(';')[0]}`;
    out.set(e.item, entry);
  }
  return out;
}

/**
 * The note a permission-blocked reported event carries. @param {string[]} commands
 */
export const refusedNote = (commands) => `refused ${commands.join(', ')}`;
