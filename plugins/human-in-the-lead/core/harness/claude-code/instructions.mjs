// The harness calls the orchestrator makes for a dispatch (design part 15.4). The core cannot call
// Claude Code's tools from Node, so for each dispatch the adapter says exactly which tool call the
// main session makes; the orchestrator skill makes it, and `hitld dispatch handle` and
// `hitld dispatch complete` record what came back.

import { MODEL_CLASSES } from './capabilities.mjs';
import { LAUNCHER } from './launch.mjs';
import { CREDENTIAL_KIND } from './credential.mjs';

/**
 * @typedef {import('../interface.mjs').DispatchRequest} DispatchRequest
 *
 * @typedef {{ tool: 'Agent', input: Record<string, unknown> }} AgentCall
 * @typedef {{ tool: 'Bash', input: { command: string, description: string, run_in_background: boolean } }} BashCall
 *   a headless run is started by the launcher (launch.mjs), which returns at once: the call runs in
 *   the foreground and prints the run's process ID
 * @typedef {{ tool: 'SendMessage', input: { to: string, message: string, summary: string } }} SendCall
 * @typedef {{ tool: 'session', input: { cwd: string, brief_file: string, model: string, effort: string } }} SessionCall
 * @typedef {{ tool: 'say', input: { text: string, urgency: string } }} SayCall a message to the owner in the main session
 * @typedef {{ tool: 'relay', input: { session: string, dispatch: string, message: string } }} RelayCall a
 *   message for a tier-3 interactive session, which the chief of staff sends (the orchestrator, when it is both)
 * @typedef {AgentCall | BashCall | SendCall | SessionCall | SayCall | RelayCall} Instruction
 *
 * @typedef {object} PlaceOptions where things are for this dispatch
 * @property {string} [worktree] the worktree hitld env prepared (tier 3)
 * @property {string} [briefPath] the brief, saved in the private store
 * @property {string} [resultPath] where a headless run writes its JSON result
 * @property {string} [pidPath] where a headless run writes its process ID, so the watchdog can
 *   tell whether it is still running (design part 5.2)
 * @property {'headless' | 'interactive'} [tier3Mode] how a tier-3 dispatch runs; `headless` also
 *   runs a tier-1 or tier-2 dispatch as a durable process instead of a background agent, which
 *   is how a print-mode orchestrator starts every executor (HITLD-768)
 * @property {string} [permissionMode] for a headless run
 * @property {Record<string, string>} [env] the executor's environment (HITLD_DISPATCH, HITLD_PROJECT_ID, HITLD_ROLE)
 * @property {string} [machineDir] this machine's directory of hitld data, where the launcher also
 *   looks for the long-lived credential a headless run starts on (HITLD-880)
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
  if (request.tier <= 2 && place.tier3Mode !== 'headless') {
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
    throw new Error('a tier-3 or headless dispatch needs its worktree and brief file');
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
  if (!place.resultPath || !place.pidPath) {
    throw new Error('a headless dispatch needs its result and pid files');
  }
  const words = [
    'claude',
    '-p',
    ...STREAM,
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    '--permission-mode',
    place.permissionMode ?? 'acceptEdits',
  ];
  return {
    tool: 'Bash',
    input: {
      command: durableCommand({
        worktree: place.worktree,
        env: { HITLD_DISPATCH: request.dispatch, ...(place.env ?? {}) },
        briefPath: place.briefPath,
        resultPath: place.resultPath,
        pidPath: place.pidPath,
        ...(place.machineDir ? { machineDir: place.machineDir } : {}),
        words,
      }),
      description: `Start ${request.dispatch} (${request.item}) as a durable headless process`,
      run_in_background: false,
    },
  };
}

/**
 * A headless run's output: every event as a JSON line (stream-json needs --verbose in print mode),
 * so the result file shows the run's progress while it runs and its result event once it ends.
 */
const STREAM = ['--output-format', 'stream-json', '--verbose'];

/**
 * The command line that starts a headless run as a durable process (launch.mjs): its own process
 * group, its brief on standard input, its events in the result file and its process ID in the pid
 * file, all in the store. It returns at once, printing the process ID.
 * With `cleanup`, the launcher itself starts the run in the worktree (`--cwd`, no `cd` before it)
 * and removes those files when the launch fails, the worktree missing included, along with the
 * result and error files it opened: what was written for a run that never started goes with it.
 * A claude run starts on a long-lived credential or not at all (`--credential`, HITLD-880): the
 * launcher reads it into the run's environment only, looking in the keychain and in `machineDir`.
 * @param {{ worktree: string, env: Record<string, string>, briefPath: string, resultPath: string,
 *   pidPath: string, words: string[], cleanup?: string[], machineDir?: string }} r
 */
export function durableCommand(r) {
  const cleanup = r.cleanup ?? [];
  const launch = [
    'node',
    LAUNCHER,
    ...(cleanup.length ? ['--cwd', r.worktree, ...cleanup.flatMap((f) => ['--cleanup', f])] : []),
    ...(r.words[0] === 'claude'
      ? ['--credential', CREDENTIAL_KIND, ...(r.machineDir ? ['--machine-dir', r.machineDir] : [])]
      : []),
    '--pid',
    r.pidPath,
    '--in',
    r.briefPath,
    '--out',
    r.resultPath,
    '--err',
    r.resultPath.replace(/\.json$/, '') + '.stderr',
    '--',
    ...r.words,
  ];
  const words = `${envWords(r.env)} ${launch.map(shq).join(' ')}`;
  return cleanup.length ? words : `cd ${shq(r.worktree)} && ${words}`;
}

/**
 * The call that continues an executor with its context.
 * A tier-3 interactive session is continued by a relayed message (HITLD-739): it needs no worktree,
 * result file or process ID of its own.
 * @param {{ harnessRef: string, message: string, tier: number, mode?: 'headless' | 'interactive' | null,
 *   worktree?: string | null, sessionId?: string | null, briefPath?: string, resultPath?: string,
 *   pidPath?: string, dispatch: string, permissionMode?: string, env?: Record<string, string>,
 *   cleanup?: string[], machineDir?: string }} r `cleanup`: the files the follow-up wrote, removed
 *   if its launch fails; `machineDir`: where the launcher also looks for the run's credential
 * @returns {Instruction}
 */
export function followUpInstruction(r) {
  if (r.tier >= 3 && r.mode === 'interactive') {
    return {
      tool: 'relay',
      input: { session: r.harnessRef, dispatch: r.dispatch, message: r.message },
    };
  }
  if (r.tier <= 2 && r.mode !== 'headless') {
    return {
      tool: 'SendMessage',
      input: { to: r.harnessRef, message: r.message, summary: `follow-up ${r.dispatch}` },
    };
  }
  if (!r.sessionId || !r.worktree || !r.briefPath || !r.resultPath || !r.pidPath) {
    throw new Error(
      'a follow-up that resumes a run needs the earlier run session ID, its worktree, the message file, a result file and a pid file',
    );
  }
  const command = durableCommand({
    worktree: r.worktree,
    env: { HITLD_DISPATCH: r.dispatch, ...(r.env ?? {}) },
    briefPath: r.briefPath,
    resultPath: r.resultPath,
    pidPath: r.pidPath,
    ...(r.cleanup?.length ? { cleanup: r.cleanup } : {}),
    ...(r.machineDir ? { machineDir: r.machineDir } : {}),
    words: [
      'claude',
      '-p',
      ...STREAM,
      '--permission-mode',
      r.permissionMode ?? 'acceptEdits',
      '--resume',
      r.sessionId,
    ],
  });
  return {
    tool: 'Bash',
    input: {
      command,
      description: `Follow up ${r.dispatch} as a durable headless process`,
      run_in_background: false,
    },
  };
}
