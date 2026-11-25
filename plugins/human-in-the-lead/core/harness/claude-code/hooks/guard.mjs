#!/usr/bin/env node
// PreToolUse on Bash: executors push only their own claim branch (HITLD-746, HITLD-765: so the
// closing commit, which is the report, reaches the remote and a pull request has a head), never
// move main, never run the orchestrator's
// commands, never touch the security baseline, verdicts or accepted risks (design 10.5), and
// never write the quarantine file (design 14.7; reading it is how they learn what is quarantined).
// The system never pushes on its
// own (design part 5.3); main moves only through the merge queue (part 14.1).

// The reproducer agent's rules run in this same process, for every tool (reproducer-rules.mjs):
// hooks.json sends every tool call here, and anything that is neither an executor's Bash call nor
// the reproducer's passes through at once.
//
// Past its dispatch's token cap, an executor may take only the closing steps (HITLD-782): every
// other tool call, of any tool, is refused (budget.mjs reads the cap and the usage).

import { readBudget } from './budget.mjs';
import { isExecutor, originPushProblem, ownClaimBranch, readHookInput } from './input.mjs';
import { isReproducer, reproducerRefusal } from './reproducer-rules.mjs';

const input = readHookInput();
const command = String(input.tool_input?.command ?? '');
// Quotes and backslashes removed, so `"hitld" ri'ght's answer` reads as what the shell runs. This
// guard reads text, not a parsed shell command: variable expansion and the like can still hide a
// word from it. The command line's own refusal (core/lib/cli/commands/rights.mjs) is the second
// line, and signed answers (design part 22, Q21) the strong one.
const unquoted = command.replace(/['"\\]/g, '');
/**
 * The hitld subcommands an executor may run (claim, close, read, check, its own leases), and
 * `publish check` on text it writes for others to read. The private term list itself is not
 * among them: `private add | list | remove` are the owner's. Of the decision commands, only the
 * two read-only ones the executor contract has it run before it lists a question (HITLD-87):
 * `rights who` and `precedent match`. Every other `rights` and `precedent` subcommand stays
 * refused; asking, answering and recording are the orchestrator's or the owner's.
 */
const EXECUTOR_HITLD =
  /^\s+(work\s+(claim|close|show|ref|query|check|claims)|check\s+(contract|policy|quarantine|classification|commit-message)|publish\s+check|env\s+(setup|port\s+lease|port\s+release|lock|unlock|status|exec)|rights\s+who|precedent\s+match|--help|--version)\b/;
/** What follows each call of hitld in a command. @param {string} text */
const hitldCalls = (text) =>
  [...text.matchAll(/\bhitld(?:\.mjs)?\b/g)].map((m) => text.slice(m.index + m[0].length));
const PUSH_RULE =
  'executors push only their own claim branch, alone: git push -u origin <the hitld/ branch you are on>; never main, another branch, a tag, a delete, another remote, or with force';
/** The executor's push, the whole line; its group is the branch. */
const OWN_PUSH =
  /^\s*git\s+push\s+(?:(?:-u|--set-upstream)\s+)?origin\s+(hitld\/[A-Za-z0-9._/-]+)\s*$/;
/**
 * The one push an executor may make (HITLD-746, HITLD-791, HITLD-793): `git push [-u |
 * --set-upstream] origin hitld/<item>`, alone on the command line, where the branch is the one its
 * checkout is on and that branch holds its claim (`ownClaimBranch`), and nothing in git's
 * configuration sends it elsewhere or widens it (`originPushProblem`). No force, no other refspec,
 * remote, option or command beside it: the whole line is matched, so nothing can be chained to it.
 * Null when the push may go, else why not.
 * @param {string} text the command @param {string} dir where it runs @returns {string | null}
 */
const ownBranchPushRefusal = (text, dir) => {
  const m = OWN_PUSH.exec(text);
  if (!m) return chainedPushRefusal(text, dir) ?? PUSH_RULE;
  const branch = ownClaimBranch(dir);
  if (branch === null || m[1] !== branch) return PUSH_RULE;
  const problem = originPushProblem(dir);
  return problem && `${problem}; ${PUSH_RULE}`;
};
/**
 * The refusal for the allowed push chained with other commands, such as `git fetch origin &&
 * git push -u origin <own branch>` (HITLD-1037): still refused, since the whole line is matched,
 * but the reason says to run the two as separate commands, so the executor does not lose a round
 * guessing. Null when no part of the line is the executor's own push.
 * @param {string} text @param {string} dir @returns {string | null}
 */
const chainedPushRefusal = (text, dir) => {
  const parts = text.split(/&&|\|\||[;|\n]/);
  if (parts.length < 2) return null;
  const branch = ownClaimBranch(dir);
  if (branch === null) return null;
  const own = parts.some((p) => OWN_PUSH.exec(p)?.[1] === branch);
  return own
    ? `run the push as a command of its own, with nothing chained before or after it: run the other commands (such as git fetch) first, as a separate call, then git push -u origin ${branch} alone; ${PUSH_RULE}`
    : null;
};
/** @type {string | null} */
let why = null;
const bash = input.tool_name === undefined || input.tool_name === 'Bash';
const executor = !isReproducer(input) && isExecutor(input, process.env);
if (isReproducer(input)) {
  why = reproducerRefusal(input);
} else if (bash && executor) {
  if (/\bgit\b[^\n;&|]*\bpush\b/.test(command)) {
    const dir = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
    why = ownBranchPushRefusal(command, dir);
  } else if (/\bgit\b[^\n;&|]*\bremote\s+(add|set-url|set-head|rename|remove|rm)\b/.test(command)) {
    // origin is the project's remote only while it points where it was cloned from, and its HEAD
    // names the main branch the claim is read against (input.mjs).
    why = "executors do not add or rewire remotes; push only to the project's remote, origin";
  } else if (/\bgit\b[^\n;&|]*\bupdate-ref\b[^\n;&|]*\brefs\/heads\/main\b/.test(command)) {
    why = 'only the merge queue moves main';
  } else if (
    /\bhitld(\.mjs)?\s+(merge|dispatch|run|handover|install|ledger\s+append)\b/.test(command)
  ) {
    why = "that is the orchestrator's command, not an executor's";
  } else if (/\beval\s+accept\b/.test(unquoted) || /--accept-baseline\b/.test(unquoted)) {
    why = "accepting an eval baseline is the owner's decision; put it in your report";
  } else if (/\bsecurity\s+accept\b/.test(unquoted)) {
    why =
      "accepting a security finding as a risk is the owner's decision; propose a verdict in your report";
  } else if (
    /\bsecurity\s+(verdict|baseline|status)\b/.test(unquoted) ||
    /\bsecurity\/(baseline|verdicts|accepted-risks|pending)\.json\b/.test(unquoted)
  ) {
    why =
      "the security baseline and verdicts are not an executor's to read or write; propose a verdict in your report";
  } else if (
    /\bhitld(\.mjs)?\s+quarantine\b/.test(unquoted) ||
    (/\bquarantine\.json\b/.test(unquoted) &&
      /(>|\btee\b|\bsed\s+-\w*i|\bperl\s+-\w*i|\bmv\b|\bcp\b|\brm\b|\bgit\s+(add|apply|checkout|restore)\b)/.test(
        unquoted,
      ))
  ) {
    why =
      "quarantining a test is the orchestrator's, on the queue's evidence; say in your report which test failed and the rerun that shows it flaky";
  } else if (/\brights\b[\s\S]*\b(answer|record|overrule|reverse|rate|trust)\b/.test(unquoted)) {
    why =
      "decisions are the owner's, answered through the main session; put the question in your report";
  } else if (/\bhitld(\.mjs)?\s+release\s+make\b/.test(unquoted)) {
    why = "making a release is the owner's, from the main session; propose it in your report";
  } else if (hitldCalls(unquoted).some((rest) => !EXECUTOR_HITLD.test(rest))) {
    why = 'executors run only the hitld commands for claiming, closing, reading and checking';
  }
}
if (!why && executor) {
  const budget = await readBudget(input, process.env);
  if (budget?.reached) {
    const { budgetReason, isClosingStep } = await import('../../../lib/dispatch/budget.mjs');
    if (!isClosingStep(input)) why = budgetReason(budget);
  }
}
if (why) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `human-in-the-lead: ${why}`,
      },
    }) + '\n',
  );
}
