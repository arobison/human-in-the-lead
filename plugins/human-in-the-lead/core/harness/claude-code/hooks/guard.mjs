#!/usr/bin/env node
// PreToolUse on Bash: executors never push, never move main, never run the orchestrator's
// commands, never touch the security baseline, verdicts or accepted risks (design 10.5), and
// never write the quarantine file (design 14.7; reading it is how they learn what is quarantined).
// The system never pushes on its
// own (design part 5.3); main moves only through the merge queue (part 14.1).

import { isExecutor, readHookInput } from './input.mjs';

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
 * among them: `private add | list | remove` are the owner's.
 */
const EXECUTOR_HITLD =
  /^\s+(work\s+(claim|close|show|query|check|claims)|check\s+(contract|policy|quarantine|classification|commit-message)|publish\s+check|env\s+(setup|port\s+lease|port\s+release|lock|unlock|status|exec)|--help|--version)\b/;
/** What follows each call of hitld in a command. @param {string} text */
const hitldCalls = (text) =>
  [...text.matchAll(/\bhitld(?:\.mjs)?\b/g)].map((m) => text.slice(m.index + m[0].length));
/** @type {string | null} */
let why = null;
if (isExecutor(input, process.env)) {
  if (/\bgit\b[^\n;&|]*\bpush\b/.test(command)) why = 'executors never push; the owner pushes';
  else if (/\bgit\b[^\n;&|]*\bupdate-ref\b[^\n;&|]*\brefs\/heads\/main\b/.test(command)) {
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
  } else if (/\brights\b[\s\S]*\b(answer|overrule|reverse|rate|trust)\b/.test(unquoted)) {
    why =
      "decisions are the owner's, answered through the main session; put the question in your report";
  } else if (/\bhitld(\.mjs)?\s+release\s+make\b/.test(unquoted)) {
    why = "making a release is the owner's, from the main session; propose it in your report";
  } else if (hitldCalls(unquoted).some((rest) => !EXECUTOR_HITLD.test(rest))) {
    why = 'executors run only the hitld commands for claiming, closing, reading and checking';
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
