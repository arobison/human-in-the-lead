// The command table (design part 16.2): one entry per `hitld` command, the single source for the
// command line, its help, and later the MCP server's tools (design part 15.1).
//
// Each piece of v0-alpha owns one file under commands/, so pieces built in parallel never edit the
// same file. A command without `run` answers "not yet built" and names the piece that builds it.

import { commands as foundation } from './commands/foundation.mjs';
import { commands as tracker } from './commands/tracker.mjs';
import { commands as ledger } from './commands/ledger.mjs';
import { commands as env } from './commands/env.mjs';
import { commands as contract } from './commands/contract.mjs';
import { commands as rights } from './commands/rights.mjs';
import { commands as quota } from './commands/quota.mjs';
import { commands as evals } from './commands/eval.mjs';
import { commands as orchestrator } from './commands/orchestrator.mjs';
import { commands as config } from './commands/config.mjs';
import { commands as machine } from './commands/machine.mjs';
import { commands as later } from './commands/later.mjs';

/**
 * @typedef {import('./args.mjs').ArgSpec} ArgSpec
 *
 * @typedef {object} CommandContext
 * @property {string} cwd
 * @property {NodeJS.ProcessEnv} env
 * @property {boolean} [interactive] true only on the human command line (core/lib/cli/main.mjs). An MCP
 *   dispatcher, or anything else that builds a context, leaves it unset, so what needs it is denied by default
 * @property {import('../machine/detect.mjs').Sources} [machine] what the machine probes read; tests
 *   pass fakes, everything else leaves it unset for this machine
 *
 * @typedef {{ ok: boolean } & Record<string, unknown>} CommandResult
 *   JSON out. ok false means the command ran and found a problem (exit code 1).
 *
 * @typedef {object} Command
 * @property {string} name the words after `hitld`, such as "check policy"
 * @property {string[]} [aliases]
 * @property {string} summary one line for help and the MCP tool description
 * @property {keyof typeof PIECES} piece who builds it
 * @property {ArgSpec[]} [args]
 * @property {boolean} [mcp] false for commands that make no sense as an MCP tool; default true
 * @property {(input: Record<string, unknown>, ctx: CommandContext) => CommandResult | Promise<CommandResult>} [run]
 */

/** Who builds what. Letters are the v0-alpha pieces (design part 21). */
export const PIECES = Object.freeze({
  foundation: 'the foundation',
  a: 'piece (a), the files tracker backend',
  b: 'piece (b), the ledger and orchestrator continuity',
  c: 'piece (c), the environment resource manager',
  d: 'piece (d), the executor contract',
  e: 'piece (e), decision rights with precedent',
  f: 'piece (f), quotas and the reserve rule',
  g: 'piece (g), the eval runner',
  h: 'piece (h), the orchestrator, the Claude Code adapter, the merge queue and packaging',
  v0: 'the rest of v0, after v0-alpha',
  M1: 'milestone M1 (measures)',
  M2: 'milestone M2 (controllers)',
  M4: 'milestone M4 (knowledge base upkeep)',
  C1: 'milestone C1 (the Copilot adapter)',
  major: 'the first release with a breaking schema change',
});

/** @type {readonly Command[]} */
export const COMMANDS = Object.freeze([
  ...foundation,
  ...tracker,
  ...ledger,
  ...env,
  ...contract,
  ...rights,
  ...quota,
  ...evals,
  ...orchestrator,
  ...config,
  ...machine,
  ...later,
]);

/**
 * Find the command named by the leading words, longest match first.
 * @param {string[]} words
 * @returns {{ command: Command, rest: string[] } | null}
 */
export function findCommand(words) {
  for (let n = Math.min(words.length, 3); n > 0; n--) {
    const name = words.slice(0, n).join(' ');
    const command = COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
    if (command) return { command, rest: words.slice(n) };
  }
  return null;
}

/** The MCP tool name for a command: its words joined by underscores. @param {Command} c */
export function toolName(c) {
  return c.name.replace(/[ -]/g, '_');
}
