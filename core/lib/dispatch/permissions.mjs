// Executors that cannot run the contract's commands (HITLD-141). The contract needs an executor to
// run hitld, node, npm and git. A harness whose permission mode refuses them leaves the executor
// unable to claim, commit or close. A completion whose structured permission_denials show those
// commands refused is recorded as blocked by permissions (reason executor-permissions). For the
// rest of the run, the plan does not dispatch any item into the same refusal on this harness: it
// uses the other tier-3 mode, or holds the item. A report whose text only mentions a refusal is a
// warning for the orchestrator, never a hold.

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
 * The contract commands a completion's structured permission_denials show refused, in
 * CONTRACT_COMMANDS order; empty when none. Each denial is a headless run's entry (tool_name and
 * tool_input); a Bash call whose command line starts with a contract command counts. Only this
 * decides a permissions block.
 * @param {unknown} denials
 * @returns {string[]}
 */
export function refusedCommands(denials) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const d of Array.isArray(denials) ? denials : []) {
    const tool = d && typeof d === 'object' ? /** @type {any} */ (d).tool_name : null;
    if (tool !== 'Bash') continue;
    const name = leadingCommand(/** @type {any} */ (d).tool_input?.command);
    if (name) found.add(name);
  }
  return CONTRACT_COMMANDS.filter((c) => found.has(c));
}

/**
 * The contract commands a report's text mentions next to a refusal (denied, refused, not
 * permitted, not allowed, permission), in CONTRACT_COMMANDS order: a warning for the orchestrator,
 * never a hold, since a report may only quote a refusal. A report whose result is done is not read.
 * @param {{ report: string, done?: boolean }} r
 * @returns {string[]}
 */
export function mentionedRefusals(r) {
  if (r.done) return [];
  /** @type {Set<string>} */
  const found = new Set();
  for (const line of String(r.report ?? '').split('\n')) {
    if (!REFUSAL.test(line)) continue;
    for (const m of line.matchAll(COMMAND)) found.add(m[1]);
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
 * The modes a report in this run showed refused on this harness, with why: the dispatch, its item
 * and the commands it was refused. A refusal counts for every item for the rest of the run; only
 * the run `runId` counts, so a new run starts without them. The first refusal of a mode is kept.
 * @param {Record<string, any>[]} events the ledger
 * @param {string | null | undefined} runId
 * @returns {Partial<Record<ExecutorMode, string>>}
 */
export function refusalsInRun(events, runId) {
  /** @type {Map<string, Record<string, any>>} */
  const dispatched = new Map();
  /** @type {Partial<Record<ExecutorMode, string>>} */
  const out = {};
  if (!runId) return out;
  for (const e of events) {
    if (e.event === 'dispatched') dispatched.set(e.dispatch, e);
    if (e.event !== 'reported' || e.reason !== PERMISSIONS_REASON || e.run !== runId) continue;
    const mode = modeOf(dispatched.get(e.dispatch));
    if (out[mode]) continue;
    const how = mode === 'subagent' ? 'as a subagent' : mode;
    const note = String(e.notes ?? 'refused the contract commands').split(';')[0];
    out[mode] = `${e.dispatch} (${e.item}) ran ${how} and its permission mode ${note}`;
  }
  return out;
}

/**
 * The note a permission-blocked reported event carries. @param {string[]} commands
 */
export const refusedNote = (commands) => `refused ${commands.join(', ')}`;
