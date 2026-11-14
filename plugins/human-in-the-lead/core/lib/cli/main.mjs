// The `hitld` command line: a thin wrapper over the library, JSON in and out (design part 16.2).
//
// Exit codes: 0 ok; 1 the command ran and found a problem, or failed; 2 usage error;
// 3 the command is not yet built.

import { parseArgs, UsageError } from './args.mjs';
import { COMMANDS, PIECES, findCommand } from './table.mjs';
import { NAME, VERSION } from '../version.mjs';

/**
 * @typedef {import('./table.mjs').Command} Command
 * @typedef {{ out: (text: string) => void, err: (text: string) => void, cwd: string, env: NodeJS.ProcessEnv,
 *   machine?: import('../machine/detect.mjs').Sources }} Io machine: fake probe sources, for tests
 */

export const EXIT = Object.freeze({ ok: 0, failed: 1, usage: 2, notBuilt: 3 });

/** @param {Command} c */
const usageLine = (c) =>
  [
    `hitld ${c.name}`,
    ...(c.args ?? []).map((a) => {
      const word = a.positional
        ? `<${a.name}>`
        : `--${a.name}${a.type === 'boolean' ? '' : ' <value>'}${a.repeatable ? '...' : ''}`;
      return a.required ? word : `[${word}]`;
    }),
  ].join(' ');

/** Help for people: every command, and who builds the ones not yet built. */
export function helpText() {
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  const lines = COMMANDS.map(
    (c) => `  ${c.name.padEnd(width)}${c.summary}${c.run ? '' : ` [${c.piece}]`}`,
  );
  const unbuilt = [...new Set(COMMANDS.filter((c) => !c.run).map((c) => c.piece))];
  return [
    `hitld ${VERSION}: ${NAME}. Agents do the work; people set the direction and make the calls.`,
    '',
    'Usage: hitld <command> [options]',
    '       hitld <command> --help',
    '',
    'Every command writes JSON to standard output. Exit codes: 0 ok, 1 problem found or failed,',
    '2 usage error, 3 not yet built.',
    '',
    'Commands:',
    ...lines,
    '',
    'A tag in brackets marks a command not yet built, and names who builds it (docs/design/0001-human-in-the-lead/21-scope.md):',
    ...unbuilt.map((p) => `  [${p}] ${PIECES[p]}`),
    '',
  ].join('\n');
}

/** @param {Command} c */
function commandHelp(c) {
  const word = (/** @type {import('./args.mjs').ArgSpec} */ a) =>
    a.positional ? `<${a.name}>` : `--${a.name}`;
  const width = Math.max(0, ...(c.args ?? []).map((a) => word(a).length)) + 2;
  const args = (c.args ?? []).map((a) => `  ${word(a).padEnd(width)}${a.description}`);
  return [
    usageLine(c),
    '',
    c.summary + '.',
    ...(c.aliases?.length ? ['', `Also: ${c.aliases.map((a) => `hitld ${a}`).join(', ')}`] : []),
    ...(args.length ? ['', 'Options:', ...args] : []),
    ...(c.run ? [] : ['', `Not yet built: ${PIECES[c.piece]} builds it.`]),
    '',
  ].join('\n');
}

/** @param {Io} io @param {unknown} value */
const json = (io, value) => io.out(JSON.stringify(value, null, 2) + '\n');

/**
 * Run the command line.
 * @param {string[]} argv the words after `hitld`
 * @param {Io} io
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, io) {
  if (argv.length === 0 || ['--help', '-h', 'help'].includes(argv[0])) {
    io.out(helpText());
    return EXIT.ok;
  }
  if (argv[0] === '--version') argv = ['version'];

  const found = findCommand(argv);
  if (!found) {
    const message = `unknown command "${argv.join(' ')}"; run hitld --help for the list`;
    json(io, { ok: false, error: 'usage', message });
    return EXIT.usage;
  }
  const { command, rest } = found;
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(commandHelp(command));
    return EXIT.ok;
  }
  if (!command.run) {
    json(io, {
      ok: false,
      error: 'not_built',
      command: command.name,
      piece: command.piece,
      message: `hitld ${command.name} is not yet built: ${PIECES[command.piece]}, builds it. See docs/design/0001-human-in-the-lead/21-scope.md.`,
    });
    return EXIT.notBuilt;
  }

  let input;
  try {
    input = parseArgs(rest, command.args ?? []);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    json(io, { ok: false, error: 'usage', message: `${e.message}. Usage: ${usageLine(command)}` });
    return EXIT.usage;
  }

  try {
    const result = await command.run(input, {
      cwd: io.cwd,
      env: io.env,
      interactive: true,
      machine: io.machine,
    });
    json(io, result);
    return result.ok ? EXIT.ok : EXIT.failed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    json(io, { ok: false, error: 'failed', command: command.name, message });
    return EXIT.failed;
  }
}
