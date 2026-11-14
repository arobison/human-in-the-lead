// Feedback about HITLd (design part 18.4). Records go to the consuming project's private store as
// feedback/FB-<n> (HITLD-46). Publishing is separate (HITLD-47): the generalizer's draft is checked
// by `feedback draft`, and `feedback publish` takes the person's answer through the send gate,
// which alone calls the filer. The filer is a dependency, so tests and evals use a fake.

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
import { SOURCES, routeFeedback } from '../../feedback/route.mjs';
import { answerPublication, pending, recordDraft } from '../../feedback/publish.mjs';
import { ghFiler } from '../../feedback/filer.mjs';
import { GateRefusal, approvalRefusal } from '../../sendgate/gate.mjs';

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

/**
 * The policy, which publishing needs (feedback.approvers).
 * @param {import('../table.mjs').CommandContext} ctx
 */
function policyOf(ctx) {
  const loaded = loadPolicy({ cwd: ctx.cwd });
  if (!loaded.policy) {
    const why = loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ');
    throw new Error(`publishing needs a valid policy.json (${why})`);
  }
  return loaded.policy;
}

/** A refusal as data, or null when the person may go on. @param {import('../table.mjs').CommandContext} ctx @param {string} name */
function refused(ctx, name) {
  const why = approvalRefusal(ctx);
  return why
    ? {
        ok: false,
        error: 'not_permitted',
        message: `hitld ${name} is the person's, through the main session in the primary checkout (${why}); an executor puts feedback in its report`,
      }
    : null;
}

/**
 * @param {{ makeFiler: (ctx: import('../table.mjs').CommandContext) => import('../../sendgate/gate.mjs').Filer }} deps
 * @returns {import('../table.mjs').Command[]}
 */
export function makeCommands({ makeFiler }) {
  return [
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
    {
      name: 'feedback route',
      summary:
        "Say where feedback-like text goes: record it (about HITLd, from the person's own turn), a project note, ask the person, or quote it back (from anywhere but the person)",
      piece: 'feedback',
      args: [
        {
          name: 'from',
          type: 'string',
          required: true,
          description: `Where the text came from: ${SOURCES.join(', ')}. Only turn, the person's own turn in the main session, is ever recorded`,
        },
        { name: 'words', type: 'string', required: true, description: 'The text, verbatim' },
      ],
      run: (input) => ({
        ok: true,
        ...routeFeedback({ from: String(input.from), words: String(input.words) }),
      }),
    },
    {
      name: 'feedback draft',
      summary:
        "Record the generalizer's public draft of a waiting record. A draft that is not public, or holds a name, path, person or ID from the record's context, is withheld with the reason",
      piece: 'feedback',
      args: [
        {
          name: 'id',
          type: 'string',
          positional: true,
          required: true,
          description: 'The record, such as FB-3',
        },
        {
          name: 'draft',
          type: 'string',
          required: true,
          description:
            'JSON from the generalizer agent: { title, area?, what_happened, expected?, evidence?, classification, reason? }. Untrusted until checked',
        },
        STORE,
      ],
      run: (input, ctx) => {
        const no = refused(ctx, 'feedback draft');
        if (no) return no;
        /** @type {unknown} */
        let draft;
        try {
          draft = JSON.parse(String(input.draft));
        } catch {
          throw new Error('--draft is not valid JSON');
        }
        const store = openPrivate(input, ctx);
        const loaded = loadPolicy({ cwd: ctx.cwd });
        const { record, withheld, reasons } = recordDraft(store, String(input.id), draft, {
          ctx,
          policy: loaded.policy,
        });
        return { ok: true, id: record.id, state: record.state, withheld, reasons };
      },
    },
    {
      name: 'feedback publish',
      summary:
        "Show each drafted record beside the person's words, or take the person's answer on one: approve, edit, by-hand or drop. Only an approved draft is filed, as an issue in HITLd's repository",
      piece: 'feedback',
      mcp: false,
      args: [
        {
          name: 'id',
          type: 'string',
          positional: true,
          description: 'The record to answer, such as FB-3. Without it, list what is waiting',
        },
        {
          name: 'answer',
          type: 'string',
          description:
            "The person's answer, from their own turn in the main session: approve, edit (with the changed text), by-hand (they post it themselves) or drop",
        },
        {
          name: 'by',
          type: 'string',
          description:
            'Who approves: owner or a contributor ID (default owner); must be in policy feedback.approvers',
        },
        {
          name: 'url',
          type: 'string',
          description: 'For a record approved by-hand: the issue the person posted',
        },
        { name: 'title', type: 'string', description: 'With edit: the new title' },
        { name: 'area', type: 'string', description: 'With edit: the new loop or area' },
        { name: 'what_happened', type: 'string', description: 'With edit: the new account' },
        { name: 'expected', type: 'string', description: 'With edit: what was expected' },
        { name: 'evidence', type: 'string', description: 'With edit: the new evidence' },
        STORE,
      ],
      run: async (input, ctx) => {
        const no = refused(ctx, 'feedback publish');
        if (no) return no;
        const store = openPrivate(input, ctx);
        if (input.id === undefined) {
          if (input.answer !== undefined || input.url !== undefined) {
            throw new Error('--answer and --url need the record ID');
          }
          return { ok: true, ...pending(store) };
        }
        if (input.answer === undefined && input.url === undefined) {
          throw new Error('give --answer, or --url for a record posted by hand');
        }
        try {
          const r = await answerPublication(
            store,
            String(input.id),
            {
              answer: /** @type {string | undefined} */ (input.answer),
              by: /** @type {string | undefined} */ (input.by),
              url: /** @type {string | undefined} */ (input.url),
              edits: {
                title: /** @type {string | undefined} */ (input.title),
                area: /** @type {string | undefined} */ (input.area),
                what_happened: /** @type {string | undefined} */ (input.what_happened),
                expected: /** @type {string | undefined} */ (input.expected),
                evidence: /** @type {string | undefined} */ (input.evidence),
              },
            },
            { ctx, policy: policyOf(ctx), filer: makeFiler(ctx) },
          );
          return {
            ok: true,
            id: r.record.id,
            state: r.record.state,
            filed: r.filed,
            ...(r.record.url ? { url: r.record.url } : {}),
            ...(r.issue ? { issue: r.issue } : {}),
          };
        } catch (e) {
          if (e instanceof GateRefusal) return { ok: false, error: e.code, message: e.message };
          throw e;
        }
      },
    },
  ];
}

/** @type {import('../table.mjs').Command[]} */
export const commands = makeCommands({ makeFiler: (ctx) => ghFiler({ env: ctx.env }) });
