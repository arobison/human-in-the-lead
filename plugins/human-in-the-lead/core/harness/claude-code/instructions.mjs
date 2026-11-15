// The harness calls the orchestrator makes for a dispatch (design part 15.4). The core cannot call
// Claude Code's tools from Node, so for each dispatch the adapter says exactly which tool call the
// main session makes; the orchestrator skill makes it, and `hitld dispatch handle` and
// `hitld dispatch complete` record what came back.

import { MODEL_CLASSES } from './capabilities.mjs';

/**
 * @typedef {import('../interface.mjs').DispatchRequest} DispatchRequest
 *
 * @typedef {{ tool: 'Agent', input: Record<string, unknown> }} AgentCall
 * @typedef {{ tool: 'Bash', input: { command: string, description: string, run_in_background: true } }} BashCall
 * @typedef {{ tool: 'SendMessage', input: { to: string, message: string, summary: string } }} SendCall
 * @typedef {{ tool: 'session', input: { cwd: string, brief_file: string, model: string, effort: string } }} SessionCall
 * @typedef {{ tool: 'say', input: { text: string, urgency: string } }} SayCall a message to the owner in the main session
 * @typedef {AgentCall | BashCall | SendCall | SessionCall | SayCall} Instruction
 *
 * @typedef {object} PlaceOptions where things are for this dispatch
 * @property {string} [worktree] the worktree hitld env prepared (tier 3)
 * @property {string} [briefPath] the brief, saved in the private store
 * @property {string} [resultPath] where a headless run writes its JSON result
 * @property {string} [pidPath] where a headless run writes its process ID, so the watchdog can
 *   tell whether it is still running (design part 5.2)
 * @property {'headless' | 'interactive'} [tier3Mode]
 * @property {string} [permissionMode] for a headless run
 * @property {Record<string, string>} [env] the executor's environment (HITLD_DISPATCH, HITLD_PROJECT_ID, HITLD_ROLE)
 */

/** The plugin's agent for a tier. @param {number} tier */
export const agentFor = (tier) => `human-in-the-lead:executor-tier${tier >= 2 ? 2 : 1}`;

/** A Claude Code model name from a model class (or a name already). @param {string | undefined} m */
export const modelName = (m) =>
  m === undefined || m === 'own'
    ? undefined
    : (MODEL_CLASSES[/** @type {keyof typeof MODEL_CLASSES} */ (m)] ?? m);

/** Quote a word for a POSIX shell. @param {string} s */
export const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** Environment assignments for a shell command line. @param {Record<string, string>} env */
const envWords = (env) =>
  Object.entries(env)
    .filter(([k]) => /^[A-Z_][A-Z0-9_]*$/.test(k))
    .map(([k, v]) => `${k}=${shq(v)}`)
    .join(' ');

/**
 * The call that starts a dispatch.
 * @param {DispatchRequest} request @param {PlaceOptions} [place]
 * @returns {Instruction}
 */
export function instructionFor(request, place = {}) {
  const model = modelName(request.model);
  const effort = request.effort === 'own' ? undefined : request.effort;
  if (request.tier <= 2) {
    return {
      tool: 'Agent',
      input: {
        subagent_type: agentFor(request.tier),
        description: `${request.dispatch} ${request.item}`,
        name: request.dispatch,
        prompt: request.brief,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(request.isolation === 'worktree' ? { isolation: 'worktree' } : {}),
        run_in_background: true,
      },
    };
  }
  if (!place.worktree || !place.briefPath)
    throw new Error('a tier-3 dispatch needs its worktree and brief file');
  if (place.tier3Mode === 'interactive') {
    return {
      tool: 'session',
      input: {
        cwd: place.worktree,
        brief_file: place.briefPath,
        model: model ?? 'opus',
        effort: effort ?? 'high',
      },
    };
  }
  if (!place.resultPath) throw new Error('a headless dispatch needs its result file');
  const words = [
    'claude',
    '-p',
    '--output-format',
    'json',
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    '--permission-mode',
    place.permissionMode ?? 'acceptEdits',
  ];
  const env = envWords({ HITLD_DISPATCH: request.dispatch, ...(place.env ?? {}) });
  const command = `cd ${shq(place.worktree)} && ${pidWord(place.pidPath)}${env} ${words.map(shq).join(' ')} < ${shq(place.briefPath)} > ${shq(place.resultPath)}`;
  return {
    tool: 'Bash',
    input: {
      command,
      description: `Run ${request.dispatch} (${request.item}) headless`,
      run_in_background: true,
    },
  };
}

/**
 * The words that record the shell's process ID before a headless run: the shell waits for the run,
 * so the ID is alive exactly as long as the run is. @param {string | undefined} pidPath
 */
const pidWord = (pidPath) => (pidPath ? `echo $$ > ${shq(pidPath)} && ` : '');

/**
 * The call that continues an executor with its context.
 * @param {{ harnessRef: string, message: string, tier: number, worktree?: string | null, sessionId?: string | null,
 *   briefPath?: string, resultPath?: string, pidPath?: string, dispatch: string, permissionMode?: string, env?: Record<string, string> }} r
 * @returns {Instruction}
 */
export function followUpInstruction(r) {
  if (r.tier <= 2) {
    return {
      tool: 'SendMessage',
      input: { to: r.harnessRef, message: r.message, summary: `follow-up ${r.dispatch}` },
    };
  }
  if (!r.sessionId || !r.worktree || !r.briefPath || !r.resultPath) {
    throw new Error(
      'a headless follow-up needs the earlier run session ID, its worktree, the message file and a result file',
    );
  }
  const command = `cd ${shq(r.worktree)} && ${pidWord(r.pidPath)}${envWords({ HITLD_DISPATCH: r.dispatch, ...(r.env ?? {}) })} claude -p --output-format json --permission-mode ${shq(r.permissionMode ?? 'acceptEdits')} --resume ${shq(r.sessionId)} < ${shq(r.briefPath)} > ${shq(r.resultPath)}`;
  return {
    tool: 'Bash',
    input: { command, description: `Follow up ${r.dispatch} headless`, run_in_background: true },
  };
}
