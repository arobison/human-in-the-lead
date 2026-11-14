// Feedback about HITLd, recorded locally (design part 18.4, HITLD-46). Records go to the consuming
// project's private store as feedback/FB-<n>; nothing here publishes (that is HITLD-47).

import { resolve } from 'node:path';
import { ID as CLAUDE_CODE } from '../../../harness/claude-code/adapter.mjs';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import {
  KINDS,
  assertPrivate,
  dropRecord,
  isWaiting,
  readRecord,
  readRecords,
  recordFeedback,
} from '../../feedback/record.mjs';
import { renderIssueBody } from '../../feedback/render.mjs';

/** @type {import('../args.mjs').ArgSpec} */
const STORE = {
  name: 'store',
  type: 'string',
  description:
    "The private store directory. Default: the project's, from policy.json (project.id) under $XDG_DATA_HOME/human-in-the-lead. Refused if it is inside the repository or a worktree",
};

/**
 * Open the private store, and refuse one inside the repository or a worktree.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 */
function openPrivate(input, ctx) {
  /** @type {string} */
  let root;
  if (typeof input.store === 'string') {
    root = resolve(ctx.cwd, input.store);
  } else {
    const loaded = loadPolicy({ cwd: ctx.cwd });
    if (!loaded.policy) {
      const why = loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ');
      throw new Error(
        `cannot find the private store without a valid policy.json (${why}); or pass --store`,
      );
    }
    root = privateStorePath(loaded.policy.project.id, {
      env: ctx.env,
      repoRoot: findRepoRoot(ctx.cwd) ?? undefined,
    });
  }
  const store = openStore(root);
  assertPrivate(store, ctx.cwd);
  return store;
}

/** @param {import('../../feedback/record.mjs').FeedbackRecord} r */
const brief = (r) => ({
  id: r.id,
  kind: r.kind,
  state: r.state,
  area: r.area ?? null,
  refs: r.refs,
  created_at: r.created_at,
  words: r.words,
});

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'feedback',
    summary:
      'Record feedback about HITLd in the private store, with its context (the version, the harness, what the ledger says about the refs)',
    piece: 'feedback',
    args: [
      {
        name: 'kind',
        type: 'string',
        required: true,
        description: `What kind of feedback: ${KINDS.join(', ')}`,
      },
      {
        name: 'words',
        type: 'string',
        required: true,
        description: "The person's words, verbatim",
      },
      {
        name: 'refs',
        type: 'string',
        description:
          'Comma-separated dispatch, decision, item or ledger event IDs, such as D-3,HITLD-12. A malformed ID is an error',
      },
      {
        name: 'area',
        type: 'string',
        description:
          'The loop or command concerned. Default: the loop of the ledger entries for the refs',
      },
      { name: 'expected', type: 'string', description: 'What the person expected' },
      {
        name: 'harness',
        type: 'string',
        description: `The harness adapter ID. Default: ${CLAUDE_CODE}`,
      },
      {
        name: 'harness_version',
        type: 'string',
        description:
          "The harness's version, when the caller knows it. The core cannot learn it offline; default: unknown",
      },
      { name: 'json', type: 'boolean', description: 'Include the whole record in the output' },
      STORE,
    ],
    run: (input, ctx) => {
      const store = openPrivate(input, ctx);
      const { record, unmatched } = recordFeedback(store, {
        cwd: ctx.cwd,
        kind: String(input.kind),
        words: String(input.words),
        refs: /** @type {string | undefined} */ (input.refs),
        area: /** @type {string | undefined} */ (input.area),
        expected: /** @type {string | undefined} */ (input.expected),
        harness: /** @type {string | undefined} */ (input.harness),
        harnessVersion: /** @type {string | undefined} */ (input.harness_version),
        defaultHarness: CLAUDE_CODE,
      });
      return {
        ok: true,
        id: record.id,
        state: record.state,
        // Refs that are well formed but have no ledger entry: kept on the record, and said here.
        unmatched_refs: unmatched,
        ...(input.json ? { record } : { feedback: brief(record) }),
      };
    },
  },
  {
    name: 'feedback list',
    summary: 'Show the feedback records still waiting to be published (local or drafted)',
    piece: 'feedback',
    args: [
      { name: 'all', type: 'boolean', description: 'Show every record, whatever its state' },
      { name: 'json', type: 'boolean', description: 'Include the whole records in the output' },
      STORE,
    ],
    run: (input, ctx) => {
      const store = openPrivate(input, ctx);
      const { records, problems } = readRecords(store);
      const shown = input.all ? records : records.filter(isWaiting);
      return {
        ok: problems.length === 0,
        total: records.length,
        waiting: records.filter(isWaiting).length,
        records: input.json ? shown : shown.map(brief),
        problems,
      };
    },
  },
  {
    name: 'feedback drop',
    summary: 'Mark a feedback record dropped, so it is never published',
    piece: 'feedback',
    args: [
      {
        name: 'id',
        type: 'string',
        positional: true,
        required: true,
        description: 'The record, such as FB-3',
      },
      STORE,
    ],
    run: (input, ctx) => {
      const store = openPrivate(input, ctx);
      const { record, changed } = dropRecord(store, String(input.id), ctx.cwd);
      return { ok: true, id: record.id, state: record.state, changed };
    },
  },
  {
    name: 'feedback render',
    summary:
      "Print a record's issue body under the headings of the issue forms (HITLd version, Harness, Loop or area, What happened, What you expected, Evidence)",
    piece: 'feedback',
    args: [
      {
        name: 'id',
        type: 'string',
        positional: true,
        required: true,
        description: 'The record, such as FB-3',
      },
      STORE,
    ],
    run: (input, ctx) => {
      const store = openPrivate(input, ctx);
      const record = readRecord(store, String(input.id));
      return {
        ok: true,
        id: record.id,
        kind: record.kind,
        classification: record.classification,
        body: renderIssueBody(record),
      };
    },
  },
];
