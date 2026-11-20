// Friction signals (HITLD-595, design part 18.4): `hitld friction messages` gives the independent
// reader what it classifies, and `hitld friction scan` reads a session record into friction events
// in the ledger, with the reader's classifications once it has them.

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { LedgerError } from '../../ledger/ledger.mjs';
import { sessionFriction } from '../../../harness/claude-code/friction.mjs';
import { acceptClassified, recordFriction } from '../../friction/friction.mjs';
import { executorSignal } from '../executor.mjs';

/** @type {import('../args.mjs').ArgSpec} */
const RECORD = {
  name: 'session-record',
  type: 'string',
  required: true,
  description:
    "The harness's record of the session, saved to a file: a cloud session's event list (its pages, or its events one per line), or claude -p --output-format stream-json output",
};
/** @type {import('../args.mjs').ArgSpec} */
const STORE = {
  name: 'store',
  type: 'string',
  description:
    "The private store directory. Default: the project's, from policy.json (project.id) under $XDG_DATA_HOME/human-in-the-lead",
};

/** @param {string} path @param {import('../table.mjs').CommandContext} ctx */
const readFile = (path, ctx) =>
  readFileSync(isAbsolute(path) ? path : resolve(ctx.cwd, path), 'utf8');

/** @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx */
function storeOf(input, ctx) {
  if (typeof input.store === 'string') return openStore(input.store);
  const loaded = loadPolicy({ cwd: ctx.cwd });
  if (!loaded.policy) return null;
  return openStore(
    privateStorePath(loaded.policy.project.id, {
      env: ctx.env,
      repoRoot: findRepoRoot(ctx.cwd) ?? undefined,
    }),
  );
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'friction messages',
    summary:
      "The owner's messages and the questions in a session record, for the independent reader to classify",
    built_by: 'feedback',
    args: [RECORD],
    output: ['ok', 'messages'],
    run: (input, ctx) => ({
      ok: true,
      messages: sessionFriction(readFile(String(input['session-record']), ctx)).messages,
    }),
  },
  {
    name: 'friction scan',
    summary:
      "Record the friction in a session record as ledger events: the deterministic classes, and the independent reader's classifications when given. A second scan adds nothing",
    built_by: 'feedback',
    args: [
      RECORD,
      {
        name: 'classified',
        type: 'string',
        description:
          "The independent reader's output for this record, a JSON array of { ref, class, quote, confidence } (class null for none); lines that fail the checks are reported and left out",
      },
      {
        name: 'session',
        type: 'string',
        description: 'The ID of the session the record is of, kept on each event',
      },
      { name: 'dry-run', type: 'boolean', description: 'Show the events without appending them' },
      STORE,
    ],
    output: ['ok', 'appended', 'already', 'by_class', 'rejected', 'unclassified', 'events'],
    run: (input, ctx) => {
      const why = executorSignal(ctx.env, ctx.cwd);
      if (why) {
        return {
          ok: false,
          error: 'not-permitted',
          message: `hitld friction scan is the chief of staff's, run in the primary checkout (${why}); an executor does not write the ledger`,
        };
      }
      const store = storeOf(input, ctx);
      if (!store) {
        return {
          ok: false,
          error: 'policy',
          message: 'cannot find the private store without a valid policy.json; or pass --store',
        };
      }
      const read = sessionFriction(readFile(String(input['session-record']), ctx));
      /** @type {ReturnType<typeof acceptClassified> | null} */
      let checked = null;
      if (typeof input.classified === 'string') {
        let lines;
        try {
          lines = JSON.parse(readFile(input.classified, ctx));
        } catch (e) {
          return {
            ok: false,
            error: 'usage',
            message: `--classified is not JSON: ${/** @type {Error} */ (e).message}`,
          };
        }
        if (!Array.isArray(lines)) {
          return { ok: false, error: 'usage', message: '--classified must be a JSON array' };
        }
        checked = acceptClassified(read.messages, lines);
      }
      try {
        const r = recordFriction(
          store,
          {
            observations: read.observations,
            ...(checked ? { accepted: checked.accepted } : {}),
            ...(typeof input.session === 'string' ? { session: input.session } : {}),
          },
          { dryRun: input['dry-run'] === true },
        );
        /** @type {Record<string, number>} */
        const byClass = {};
        for (const e of r.appended)
          byClass[e.friction_class] = (byClass[e.friction_class] ?? 0) + 1;
        return {
          ok: true,
          appended: input['dry-run'] === true ? 0 : r.appended.length,
          already: r.already,
          by_class: byClass,
          rejected: checked?.rejected ?? [],
          unclassified: checked ? checked.unclassified.length : read.messages.length,
          events: r.appended,
        };
      } catch (e) {
        if (e instanceof LedgerError) {
          return { ok: false, error: 'invalid-event', message: e.message, errors: e.errors };
        }
        throw e;
      }
    },
  },
];
