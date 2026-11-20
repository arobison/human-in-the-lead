// The reproducer (HITLD-30, design part 2.2, step 3): a reported bug becomes a failing test in a
// sandbox with no network and no secrets, and the item for it names that test as its "Done when".
//
//   reproduce open    the orchestrator opens a sandbox for one bug signal and gets the brief
//   reproduce run     the reproducer runs its test there, under the sandbox's limits
//   reproduce check   the orchestrator checks the reproducer's reply by script; a reproduction is
//                     kept at refs/hitld/reproductions/<signal>, and nothing else is kept
//   reproduce item    the orchestrator makes the proposed item whose "Done when" is that test
//
// Routing (auto-fix under a precedent, design part 2.2, step 4) is triage's (HITLD-29): the item is
// proposed, and a person commits it.

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { ownerCheckoutOf } from '../../env/primary.mjs';
import {
  ReproduceError,
  checkReproduction,
  openSandbox,
  readReproduction,
  readSandbox,
  recordReproduction,
  runSandboxed,
} from '../../reproduce/reproduce.mjs';
import { executorSignal } from '../executor.mjs';
import { open as openTrackerOf } from './tracker.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 * @typedef {import('../table.mjs').CommandResult} Result
 */

/** @param {string} path @param {Ctx} ctx */
const pathOf = (path, ctx) => (isAbsolute(path) ? path : resolve(ctx.cwd, path));

/** @param {string} what @param {Ctx} ctx @returns {Result | null} */
function orchestratorOnly(what, ctx) {
  const why = executorSignal(ctx.env, ctx.cwd);
  return why
    ? {
        ok: false,
        error: 'not-permitted',
        message: `hitld ${what} is the orchestrator's, run in the primary checkout (${why})`,
      }
    : null;
}

/** @param {Ctx} ctx @returns {string | Result} */
function repoOf(ctx) {
  const root = ownerCheckoutOf(ctx.cwd);
  return (
    root ?? {
      ok: false,
      error: 'not-a-repository',
      message: `${ctx.cwd} is not in a git repository`,
    }
  );
}

/** @param {() => Result} body @returns {Result} */
function guarded(body) {
  try {
    return body();
  } catch (e) {
    if (e instanceof ReproduceError) {
      return { ok: false, error: e.code, message: e.message, ...e.more };
    }
    throw e;
  }
}

/** @param {string} file @param {Ctx} ctx @param {string} what */
function readJson(file, ctx, what) {
  try {
    return JSON.parse(readFileSync(pathOf(file, ctx), 'utf8'));
  } catch (e) {
    throw new ReproduceError(
      'usage',
      `${what} is not a JSON file: ${/** @type {Error} */ (e).message}`,
    );
  }
}

/** @type {import('../args.mjs').ArgSpec} */
const SANDBOX = {
  name: 'sandbox',
  type: 'string',
  positional: true,
  required: true,
  description: 'The sandbox directory hitld reproduce open made',
};

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'reproduce open',
    summary:
      "Open the reproducer's sandbox for one reported bug: the base commit's files with no repository, network or secrets, and the brief (orchestrator only)",
    built_by: 'signal',
    args: [
      {
        name: 'signal',
        type: 'string',
        required: true,
        description: 'The signal record of the bug, a JSON file (schemas/signal.schema.json)',
      },
      { name: 'base', type: 'string', description: 'The commit to reproduce on (default HEAD)' },
      {
        name: 'dir',
        type: 'string',
        description: 'An absent or empty directory for the sandbox (default: a new temporary one)',
      },
    ],
    output: ['ok', 'signal', 'base', 'dir', 'work', 'brief', 'links_left_out'],
    run: (input, ctx) =>
      orchestratorOnly('reproduce open', ctx) ??
      guarded(() => {
        const repo = repoOf(ctx);
        if (typeof repo !== 'string') return repo;
        const made = openSandbox({
          repoRoot: repo,
          signal: readJson(String(input.signal), ctx, '--signal'),
          ...(typeof input.base === 'string' ? { base: input.base } : {}),
          ...(typeof input.dir === 'string' ? { dir: pathOf(input.dir, ctx) } : {}),
        });
        return {
          ok: true,
          signal: made.signal,
          base: made.base,
          dir: made.dir,
          work: made.work,
          brief: made.brief,
          links_left_out: made.links_left_out,
        };
      }),
  },
  {
    name: 'reproduce run',
    summary:
      "Run one test file in the reproducer's sandbox: no network, no secrets, no child processes, reads only inside the sandbox",
    built_by: 'signal',
    args: [
      SANDBOX,
      {
        name: 'test',
        type: 'string',
        required: true,
        description: 'The test file, relative to the sandbox files, under test/ or tests/',
      },
    ],
    output: ['ok', 'outcome', 'tests', 'failing', 'load_failure', 'network_attempts', 'stderr'],
    run: (input, ctx) =>
      guarded(() => {
        const sandbox = readSandbox(pathOf(String(input.sandbox), ctx));
        const r = runSandboxed({
          root: sandbox.work,
          test: String(input.test),
          scratch: sandbox.scratch,
        });
        return { ok: true, ...r };
      }),
  },
  {
    name: 'reproduce check',
    summary:
      "Check the reproducer's reply by script and keep a reproduction at refs/hitld/reproductions/<signal>; a bug not reproduced keeps nothing (orchestrator only)",
    built_by: 'signal',
    args: [
      SANDBOX,
      {
        name: 'reply',
        type: 'string',
        required: true,
        description: "The reproducer's reply, a JSON file: untrusted, checked here",
      },
    ],
    output: [
      'ok',
      'signal',
      'verdict',
      'reason',
      'missing',
      'refused',
      'discarded',
      'runs',
      'record',
      'ref',
      'commit',
    ],
    run: (input, ctx) =>
      orchestratorOnly('reproduce check', ctx) ??
      guarded(() => {
        const repo = repoOf(ctx);
        if (typeof repo !== 'string') return repo;
        const dir = pathOf(String(input.sandbox), ctx);
        const sandbox = readSandbox(dir);
        if (resolve(sandbox.repo) !== resolve(repo)) {
          return {
            ok: false,
            error: 'other-repository',
            message: `the sandbox was opened from ${sandbox.repo}, not this repository (${repo})`,
          };
        }
        const checked = checkReproduction({
          dir,
          reply: readJson(String(input.reply), ctx, '--reply'),
          ...(ctx.now ? { now: ctx.now } : {}),
        });
        if (checked.verdict === 'not-reproduced') {
          const { verdict, reason, missing, refused, discarded } = checked;
          return {
            ok: !refused,
            ...(refused ? { error: 'reproduction-refused', message: reason } : {}),
            signal: sandbox.signal,
            verdict,
            reason,
            missing,
            refused,
            discarded,
            ...('runs' in checked ? { runs: checked.runs } : {}),
          };
        }
        const kept = recordReproduction({
          repoRoot: repo,
          record: checked.record,
          testText: checked.testText,
        });
        return {
          ok: true,
          signal: sandbox.signal,
          verdict: 'reproduced',
          record: checked.record,
          ...kept,
        };
      }),
  },
  {
    name: 'reproduce item',
    summary:
      'Make the proposed item for a reproduced bug, whose "Done when" is its reproduced test (orchestrator only)',
    built_by: 'signal',
    args: [
      {
        name: 'signal',
        type: 'string',
        positional: true,
        required: true,
        description: 'The signal ID, such as SIG-12',
      },
      { name: 'parent', type: 'string', required: true, description: 'The project ID' },
      { name: 'title', type: 'string', required: true, description: 'One line' },
    ],
    output: ['ok', 'id', 'path', 'state', 'test', 'ref', 'commit', 'base', 'done_when'],
    run: (input, ctx) =>
      orchestratorOnly('reproduce item', ctx) ??
      guarded(() => {
        const repo = repoOf(ctx);
        if (typeof repo !== 'string') return repo;
        const signal = String(input.signal);
        const kept = readReproduction(repo, signal);
        if (!kept) {
          return {
            ok: false,
            error: 'not-reproduced',
            message: `${signal} has no reproduction (no ${'refs/hitld/reproductions/'}${signal}); an item for it starts from shaping, not from a test`,
          };
        }
        const { record, ref, commit } = kept;
        const doneWhen = [
          `- \`${record.test}\` passes. It is the reproduced test: it fails on ${record.base.slice(0, 12)}, and it exists before the executor starts, at \`${ref}\` (commit ${commit.slice(0, 12)}). Take it with \`git checkout ${ref} -- ${record.test}\`.`,
          '- The reproduced test is unchanged.',
        ];
        const body = [
          '',
          '## Why',
          '',
          `A reported bug, ${signal}, reproduced by a failing test (design part 2.2, step 3). Failing on the base: ${record.failing.map((/** @type {string} */ n) => JSON.stringify(n)).join(', ')}.`,
          '',
          '## Done when',
          '',
          ...doneWhen,
          '',
        ].join('\n');
        const tracker = openTrackerOf(input, ctx);
        const linked = tracker.layout().optionalKeys.includes('opened_from');
        const made = tracker.createEntity({
          title: input.title,
          kind: 'work',
          parent: input.parent,
          state: 'proposed',
          body,
          ...(linked ? { opened_from: [signal] } : {}),
        });
        return {
          ok: true,
          id: made.id,
          path: made.path,
          state: 'proposed',
          test: record.test,
          ref,
          commit,
          base: record.base,
          done_when: doneWhen,
          ...(made.warnings.length ? { warnings: made.warnings } : {}),
        };
      }),
  },
];
