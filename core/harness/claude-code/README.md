# The Claude Code harness adapter

Implements `HarnessAdapter` from `../interface.mjs` for Claude Code ([design part 15.4](../../../docs/design/0001-human-in-the-lead/15-architecture.md#154-the-claude-code-adapter)).

Claude Code's tools (Agent, SendMessage, background Bash, messages in the main session) can be called only by the model in the main session, never from Node. So the adapter is a contract: for each operation it produces the exact tool call (`instructions.mjs`), the orchestrator skill (`skills/orchestrate/SKILL.md`) makes it, and `hitld` records what came back:

| Step | Command | Harness call |
|---|---|---|
| Dispatch, write-ahead | `hitld dispatch start <ID>` records `dispatched`, writes the brief | prints the call |
| Tier 1-2 | | `Agent`: `subagent_type human-in-the-lead:executor-tier<N>`, `name D-<n>`, `isolation worktree`, model and effort from policy, in the background |
| Tier 3, headless | | background `Bash`: `claude -p --output-format json` in a worktree from `hitld env`, with `HITLD_DISPATCH`, `HITLD_PROJECT_ID`, `HITLD_ROLE=executor` |
| Tier 3, interactive | | the chief of staff starts a session in the prepared worktree with the brief file (the owner, when one session is both and cannot start sessions) |
| Harness reference | `hitld dispatch handle --dispatch D-<n> --harness-ref <id>` records `started` | |
| Completion | `hitld dispatch complete` records `reported`, checks the report, queues the branch, plans the refill | the notification, or the background Bash exit |
| Follow-up | `hitld dispatch follow-up` records a new dispatch on the same agent | `SendMessage` to the agent, or `claude -p --resume` |
| Hand-over | `hitld handover` writes the note and releases the lease; `hitld run retire` releases the lease of a session that ended | the chief of staff starts the successor: a cloud session, or headless `claude -p` |
| Wakes | `hitld run status` names the session that holds the lease (`wake_to`) | the chief of staff sends it each GitHub event, relayed completion and scheduled task |
| Watchdog | `hitld dispatch watch` (the chief of staff's check-in) finds stalls; `--act` records the step | poke: `SendMessage`; follow-up: stop the agent's turn, then `SendMessage`; a PostToolUse hook records each executor tool call as progress |

`createClaudeCodeAdapter({ driver })` is the same contract in process: a driver carries out the calls (tests and evals simulate one). Without a driver, an operation that needs the harness throws `ContractCall` with the instruction.

`hitld dispatch capabilities` prints the capability set and the matrix in `capabilities.mjs`, where each function is marked documented, observed (the desktop app, 2026-11-14) or contract.

Also here: `session.mjs` (the session ID Claude Code gives a session, which `hitld` takes as the session's identity on the run when no `--session` or `$HITLD_SESSION` names one; never for an executor), `completion.mjs` (the notification and the headless JSON result; usage from a notification is recorded as observed, not documented), `statusline.mjs` (the usage capture `hitld install --statusline` sets up, feeding the quota gate), and `hooks/` (the plugin's SessionStart hooks: the version check, the PATH and the store pull; the SessionEnd store push; the PreToolUse guard; and the SubagentStop/Stop report check).
