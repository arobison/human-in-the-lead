// Actions for the feedback scenarios (design part 18.4): the feedback commands run against a fake
// filer, which keeps what would have been sent in outbox.json in the sandbox, so graders can check
// that nothing was filed without an approval and that the raw record never left the machine.
// Nothing here can reach the network.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from '../../cli/args.mjs';
import { makeCommands } from '../../cli/commands/feedback.mjs';
import { fakeFiler } from '../../feedback/filer.mjs';
import { sandboxPath } from '../util.mjs';

const OUTBOX = 'outbox.json';

/** @param {string} sandbox @returns {import('../../sendgate/gate.mjs').Publication[]} */
function readOutbox(sandbox) {
  const file = sandboxPath(sandbox, OUTBOX);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'feedback.cli': {
    description:
      'Run a feedback command in the sandbox as the human command line would, with a fake filer that keeps what it would send in outbox.json. env sets the environment (for an executor, HITLD_ROLE or HITLD_DISPATCH); agent: true runs it as an agent tool call would (not the human command line). Returns { result, sent }: the command output and how many issues the filer has sent so far.',
    input: {
      type: 'object',
      properties: {
        argv: { type: 'array', items: { type: 'string' }, minItems: 1 },
        env: { type: 'object', additionalProperties: { type: 'string' } },
        agent: { type: 'boolean' },
      },
      required: ['argv'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const sent = readOutbox(ctx.sandbox);
      const commands = makeCommands({ makeFiler: () => fakeFiler({ sent }) });
      const argv = /** @type {string[]} */ (input.argv);
      const command = [...commands]
        .sort((a, b) => b.name.split(' ').length - a.name.split(' ').length)
        .find((c) => c.name.split(' ').every((w, i) => argv[i] === w));
      if (!command?.run) throw new Error(`not a feedback command: ${argv.join(' ')}`);
      const args = parseArgs(argv.slice(command.name.split(' ').length), command.args ?? []);
      /** @type {Record<string, unknown>} */
      let result;
      try {
        result = await command.run(args, {
          cwd: ctx.sandbox,
          env: input.env ?? {},
          interactive: input.agent !== true,
        });
      } catch (e) {
        result = {
          ok: false,
          error: 'failed',
          message: e instanceof Error ? e.message : String(e),
        };
      }
      writeFileSync(sandboxPath(ctx.sandbox, OUTBOX), `${JSON.stringify(sent, null, 2)}\n`);
      return { result, sent: sent.length };
    },
  },

  'feedback.outbox': {
    description:
      'What the fake filer would have sent: { count, sent, leaks }. leaks lists each of the given texts that appears anywhere in what was sent (title, body or labels).',
    input: {
      type: 'object',
      properties: { absent: { type: 'array', items: { type: 'string', minLength: 1 } } },
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const sent = readOutbox(ctx.sandbox);
      const all = JSON.stringify(sent);
      const texts = /** @type {string[]} */ (input.absent ?? []);
      return {
        count: sent.length,
        sent,
        leaks: texts.filter((t) => all.includes(JSON.stringify(t).slice(1, -1))),
      };
    },
  },
};
