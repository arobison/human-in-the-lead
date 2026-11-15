// What the Claude Code adapter supports (design parts 15.3, 15.4 and 15.7), and how each function
// is carried out. `source` says how far it is known: documented (the Claude Code documentation,
// read 2026-11-14), observed (seen in the desktop app on 2026-11-14, not documented), or contract
// (the core cannot call Claude Code's tools from Node, so the orchestrator skill makes the call
// and `hitld` records it).

/** @type {import('../interface.mjs').HarnessCapabilities} */
export const CAPABILITIES = Object.freeze({
  parallel_subagents: true,
  persistent_sessions: true,
  worktrees: true,
  background_completion: true,
  remote_human_channel: true,
  hooks: 'full',
  model_selection: true,
  effort_selection: true,
  usage_reporting: 'tokens',
  // Runs on the owner's machine. Secret material is never given to any agent (design part 10).
  max_classification: 'confidential',
});

/**
 * @typedef {{ function: string, how: string, source: 'documented' | 'observed' | 'contract', notes?: string }} MatrixRow
 * @type {readonly MatrixRow[]}
 */
export const MATRIX = Object.freeze([
  {
    function: 'tier 1-2 dispatch',
    how: 'Agent tool: subagent_type human-in-the-lead:executor-tier<N>, isolation "worktree", name = the dispatch ID, model and effort from policy.tiers, run in the background',
    source: 'contract',
    notes:
      'isolation, model, effort and name are documented Agent parameters; run_in_background was observed in the desktop app (agents also run in the background through their background front matter)',
  },
  {
    function: 'tier 3 dispatch, headless',
    how: 'Bash in the background: claude -p --output-format json --model --effort --permission-mode, in a worktree from hitld env, with HITLD_DISPATCH set; the brief on standard input, the JSON result to a file in the private store',
    source: 'contract',
    notes:
      'claude -p and its flags are documented; the background Bash exit is the completion notice',
  },
  {
    function: 'tier 3 dispatch, interactive',
    how: 'The chief of staff starts a session in the prepared worktree with the brief file, as it starts orchestrator sessions (the owner, when one session is both and cannot start sessions); it reports back in the fixed shape',
    source: 'contract',
  },
  {
    function: 'orchestrator sessions',
    how: 'The chief of staff starts each orchestrator session and its successor: on Claude Code on the web, a new cloud session with the orchestrate skill and the hand-over; locally, a headless claude -p run in the primary checkout, resumed with claude -p --resume <session_id> for the next wake. The outgoing session writes the hand-over (hitld handover) and gives up the lease; a session that ended without one is retired (hitld run retire)',
    source: 'contract',
    notes:
      'Session creation and messages between sessions are tools of Claude Code on the web; claude -p --resume is documented. Whether background subagents outlive a headless turn is not documented, so a session hands over only once its own dispatches have reported',
  },
  {
    function: 'wakes',
    how: 'GitHub events (a pull-request subscription), completion notices and scheduled tasks, all owned by the chief of staff, which sends each to the session hitld run status names (wake_to). Background-agent notices reach the session that dispatched them directly',
    source: 'contract',
    notes:
      'Scheduled tasks are cloud scheduled tasks or reminders bound to the chief of staff, desktop scheduled tasks, or the operating system scheduler; an orchestrator session creates none, so a retired one leaves none behind',
  },
  {
    function: 'completion',
    how: 'The background-agent notification, or the background Bash exit; the orchestrator passes it to hitld dispatch complete. Never polled',
    source: 'documented',
  },
  {
    function: 'usage',
    how: 'Headless: usage and total_cost_usd in the JSON result (documented). Subagents: token, tool-use and duration counts in the notification, recorded when present and labelled undocumented',
    source: 'observed',
  },
  {
    function: 'follow-up',
    how: 'SendMessage to the agent ID (resumes a finished subagent in the background); headless: claude -p --resume <session_id>',
    source: 'documented',
  },
  {
    function: 'ask and notify',
    how: 'Messages in the main session, reachable from a phone through Remote Control. Interrupts at once; digest items held for merge-batch boundaries or the next owner message; quiet hours hold all but sev-1',
    source: 'contract',
  },
  {
    function: 'hooks',
    how: 'Plugin hooks: SessionStart (puts hitld on PATH, prints the plugin path and version), SubagentStop and Stop (report shape check for executors), PreToolUse (guard: executors never push)',
    source: 'documented',
    notes:
      'Plugin agents cannot carry their own hooks, so the hooks identify executors by agent_type or HITLD_DISPATCH',
  },
  {
    function: 'executor identity',
    how: 'HITLD_DISPATCH: set on the headless command line; for subagents the brief tells the executor to prefix every hitld command with it, since a subagent has no environment of its own',
    source: 'contract',
  },
]);

/** Model classes in policy.tiers, as Claude Code names models (until the milestone Model catalog). */
export const MODEL_CLASSES = Object.freeze({ small: 'sonnet', large: 'opus' });
