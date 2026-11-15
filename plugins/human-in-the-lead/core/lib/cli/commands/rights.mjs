// Piece (e): decision rights with precedent (design part 4), and owner judgements as priors
// (design part 3.2). The library is in core/lib/rights/, core/lib/precedent/ and
// core/lib/judgement/; these commands are a thin JSON-in, JSON-out wrapper over it.
//
// Questions, answers and the like are passed as JSON text (--question '{...}') or as a path to a
// JSON file (--file), because the command-line parser takes only flat options. An MCP tool takes
// the same text.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { executorSignal } from '../executor.mjs';
import { loadPolicy, findRepoRoot } from '../../policy/policy.mjs';
import { ownerCheckoutOf } from '../../env/primary.mjs';
import { openTracker as openFilesTracker } from '../../tracker/files/tracker.mjs';
import { schemas } from '../../schema/registry.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { matchPrecedents } from '../../precedent/match.mjs';
import { openPrecedentStore } from '../../precedent/store.mjs';
import { applyPriors, conflictQuestion } from '../../judgement/judgement.mjs';
import {
  answerDecision,
  askQuestion,
  listApplications,
  overrule,
  precedentHealth,
  rateWorthAsking,
  recordReversal,
} from '../../rights/flow.mjs';
import { factsOf, normalizeQuestion, routeQuestion } from '../../rights/route.mjs';
import { readTrustEvents, trustSummary } from '../../rights/trust.mjs';

/**
 * @typedef {import('../../tracker/interface.mjs').TrackerAdapter} TrackerAdapter
 * @typedef {(options: { repoRoot: string, policy: Record<string, any>, env: NodeJS.ProcessEnv }) => Promise<TrackerAdapter> | TrackerAdapter} OpenTracker
 */

/** The private store key of the digest cursor. */
const DIGEST_KEY = 'rights/digest.json';

/**
 * Open the files tracker backend (piece (a)) of the owner's checkout, as `hitld work` and
 * `hitld security accept` do. The library works against any TrackerAdapter.
 * @type {OpenTracker}
 */
const defaultOpenTracker = ({ repoRoot, policy, env }) =>
  openFilesTracker({ repoRoot, policy, env });

/** The largest JSON input read from a file. */
const MAX_FILE_BYTES = 1_000_000;

/**
 * The question or other JSON a command was given: text, or the path of a file. A file must lie
 * inside the repository root (symbolic links resolved), and is refused outright through MCP, where
 * the caller is an agent: it may not make the tool read what it names. Errors say what was wrong
 * with the input, never what a file or a parse failure contained.
 * @param {Record<string, unknown>} input @param {string} name @param {import('../table.mjs').CommandContext} ctx
 */
function jsonInput(input, name, ctx) {
  const file = /** @type {string | undefined} */ (input.file);
  const text = /** @type {string | undefined} */ (input[name]);
  if (file !== undefined && text !== undefined)
    throw new Error(`give --${name} or --file, not both`);
  if (file === undefined && text === undefined) throw new Error(`--${name} or --file is required`);
  let raw = /** @type {string} */ (text);
  if (file !== undefined) {
    // Deny by default: only the human command line sets `interactive`. An MCP tool call, which is an
    // agent naming a path, never does, so it cannot make the tool read a file.
    if (ctx.interactive !== true) {
      throw new Error('--file is only available at the command line; pass the JSON itself');
    }
    const root = findRepoRoot(ctx.cwd);
    if (!root) throw new Error('--file needs a repository: none contains this directory');
    try {
      const path = realpathSync(resolve(ctx.cwd, file));
      const inside = relative(realpathSync(root), path);
      if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
        throw new Error('outside');
      }
      if (statSync(path).size > MAX_FILE_BYTES) throw new Error('large');
      raw = readFileSync(path, 'utf8');
    } catch {
      throw new Error('--file must name a readable file inside the repository (under 1 MB)');
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${file !== undefined ? '--file' : `--${name}`} is not valid JSON`);
  }
}

/** @param {string} text @param {string} flag */
function parseJson(text, flag) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${flag} is not valid JSON`);
  }
}

/** @param {unknown} v @param {string} flag @returns {boolean | undefined} */
function yesNo(v, flag) {
  if (v === undefined) return undefined;
  if (v === 'yes' || v === 'y' || v === 'true') return true;
  if (v === 'no' || v === 'n' || v === 'false') return false;
  throw new Error(`--${flag} must be yes or no`);
}

const FILE_ARG = {
  name: 'file',
  type: /** @type {const} */ ('string'),
  description: 'Path to a JSON file holding the input, instead of the option (command line only)',
  mcp: false,
};

/**
 * Commands never run by an executor, and whose they are: those that record or change a decision
 * are the owner's; asking creates a decision item in the primary checkout's tracker, which only
 * the orchestrator does (design part 3.4, ID allocation).
 */
const EXECUTOR_REFUSED = new Map([
  ['rights ask', "the orchestrator's"],
  ['rights answer', "the owner's"],
  ['rights overrule', "the owner's"],
  ['rights reverse', "the owner's"],
  ['rights rate', "the owner's"],
  ['rights trust', "the owner's"],
]);

/**
 * @param {{ openTracker: OpenTracker }} deps
 * @returns {import('../table.mjs').Command[]}
 */
export function makeCommands({ openTracker }) {
  /**
   * @param {import('../table.mjs').CommandContext} ctx
   * @param {{ tracker?: boolean }} [needs]
   */
  async function open(ctx, needs = {}) {
    // The primary checkout, even from inside a linked worktree: decision rights, the tracker the
    // owner's answers are recorded in, and main are the owner's there, never a branch's copy.
    const repoRoot = ownerCheckoutOf(ctx.cwd);
    const loaded = loadPolicy({ cwd: repoRoot ?? ctx.cwd });
    if (!loaded.policy) {
      return { failure: { ok: false, error: 'policy', path: loaded.path, errors: loaded.errors } };
    }
    const policy = loaded.policy;
    const store = openStore(
      privateStorePath(policy.project.id, { env: ctx.env, repoRoot: repoRoot ?? undefined }),
    );
    const precedents = openPrecedentStore({
      repoRoot,
      store,
      ceiling: policy.project.classification_ceiling,
    });
    const tracker = needs.tracker
      ? await openTracker({ repoRoot: repoRoot ?? ctx.cwd, policy, env: ctx.env })
      : /** @type {TrackerAdapter} */ (/** @type {unknown} */ (null));
    return { deps: { policy, policyHash: loaded.hash, tracker, precedents, store } };
  }

  /** @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx */
  const questionOf = (input, ctx) => {
    const question = jsonInput(input, 'question', ctx);
    const errors = schemas().validate('question', question);
    if (errors.length) throw new Error(`the question is invalid:\n${formatErrors(errors)}`);
    const paths = normalizeQuestion(question);
    if (paths.errors.length)
      throw new Error(`the question is invalid:\n${paths.errors.join('\n')}`);
    return paths.question;
  };

  const questionArgs = [
    {
      name: 'question',
      type: /** @type {const} */ ('string'),
      description: 'The question as JSON (schemas/question.schema.json)',
    },
    FILE_ARG,
  ];

  /** @type {import('../table.mjs').Command[]} */
  const commands = [
    {
      name: 'rights',
      summary:
        "Classify a call as the owner's, an area owner's or the system's, with the rule that decided it",
      piece: 'e',
      args: questionArgs,
      run: async (input, ctx) => {
        const o = await open(ctx);
        if (o.failure) return o.failure;
        const question = questionOf(input, ctx);
        return { ok: true, ...routeQuestion(question, o.deps.policy) };
      },
    },
    {
      name: 'rights ask',
      summary:
        'Route a question; resolve it by precedent if one fits, otherwise create a decision item and print the question to send',
      piece: 'e',
      args: [
        ...questionArgs,
        {
          name: 'judged',
          type: 'string',
          description:
            'JSON object: per candidate precedent ID, true if its plain-language conditions and exceptions fit this question, false if not',
        },
      ],
      run: async (input, ctx) => {
        const o = await open(ctx, { tracker: true });
        if (o.failure) return o.failure;
        const judged =
          input.judged === undefined
            ? undefined
            : parseJson(/** @type {string} */ (input.judged), '--judged');
        return askQuestion(o.deps, questionOf(input, ctx), { judged });
      },
    },
    {
      name: 'rights answer',
      summary:
        'Record the answer to a decision item, with what the decider said to the precedent offer; a confirmed generalization becomes a precedent',
      piece: 'e',
      args: [
        {
          name: 'decision',
          type: 'string',
          description: 'The decision item ID',
          positional: true,
          required: true,
        },
        {
          name: 'answer',
          type: 'string',
          description:
            'The answer as given: "A", "A yes", "B just this one", "A, only for cache keys", or free text',
          required: true,
        },
        {
          name: 'via',
          type: 'string',
          description: 'The channel it came through (default main-session)',
        },
        {
          name: 'worth-asking',
          type: 'string',
          description: 'yes or no: was it worth asking? Optional, never required',
        },
        {
          name: 'agrees-with',
          type: 'string',
          description: 'Comma-separated candidate precedent IDs the answer is consistent with',
        },
      ],
      run: async (input, ctx) => {
        const o = await open(ctx, { tracker: true });
        if (o.failure) return o.failure;
        const agrees = /** @type {string | undefined} */ (input['agrees-with']);
        return answerDecision(o.deps, {
          decision: /** @type {string} */ (input.decision),
          answer: /** @type {string} */ (input.answer),
          via: /** @type {string | undefined} */ (input.via),
          worth_asking: yesNo(input['worth-asking'], 'worth-asking'),
          ...(agrees ? { agrees_with: agrees.split(',').map((s) => s.trim()) } : {}),
        });
      },
    },
    {
      name: 'rights overrule',
      summary:
        'Reverse an application of a precedent: it is narrowed to exclude cases like this one, or retired',
      piece: 'e',
      args: [
        {
          name: 'decision',
          type: 'string',
          description: 'The decision item the precedent resolved',
          positional: true,
          required: true,
        },
        { name: 'why', type: 'string', description: 'Why, in a sentence', required: true },
        {
          name: 'when',
          type: 'string',
          description:
            "JSON: structured conditions for the exception, instead of this case's attributes",
        },
        {
          name: 'retire',
          type: 'boolean',
          description: 'Retire the precedent instead of narrowing it',
        },
      ],
      run: async (input, ctx) => {
        const o = await open(ctx, { tracker: true });
        if (o.failure) return o.failure;
        return overrule(o.deps, {
          decision: /** @type {string} */ (input.decision),
          why: /** @type {string} */ (input.why),
          ...(input.when !== undefined
            ? { when: parseJson(/** @type {string} */ (input.when), '--when') }
            : {}),
          ...(input.retire ? { retire: true } : {}),
        });
      },
    },
    {
      name: 'rights reverse',
      summary:
        'Record that the owner reversed a call the system made without a precedent (trust-calibration data)',
      piece: 'e',
      args: [
        {
          name: 'subject',
          type: 'string',
          description: 'What was reversed: a decision, a logged call, a route',
          positional: true,
          required: true,
        },
        {
          name: 'what',
          type: 'string',
          description: 'logged-call, triage-route, controller-move or other',
        },
        { name: 'area', type: 'string', description: 'The area it belongs to' },
        { name: 'note', type: 'string', description: 'Why' },
      ],
      run: async (input, ctx) => {
        const o = await open(ctx);
        if (o.failure) return o.failure;
        return recordReversal(o.deps, /** @type {any} */ (input));
      },
    },
    {
      name: 'rights rate',
      summary: 'Record whether an answered question was worth asking (trust-calibration data)',
      piece: 'e',
      args: [
        {
          name: 'decision',
          type: 'string',
          description: 'The decision item ID',
          positional: true,
          required: true,
        },
        { name: 'worth', type: 'string', description: 'yes or no', required: true },
      ],
      run: async (input, ctx) => {
        const o = await open(ctx, { tracker: true });
        if (o.failure) return o.failure;
        return rateWorthAsking(o.deps, {
          decision: /** @type {string} */ (input.decision),
          worth: /** @type {boolean} */ (yesNo(input.worth, 'worth')),
        });
      },
    },
    {
      name: 'rights digest',
      summary:
        'Applications of precedent for the digest, with those the owner overruled, and precedents due for review',
      piece: 'e',
      args: [
        {
          name: 'since',
          type: 'string',
          description: 'Only applications after this time. Default: the last digest marked',
        },
        {
          name: 'mark',
          type: 'boolean',
          description: 'Mark this digest as sent, so the next lists only what is newer',
        },
      ],
      run: async (input, ctx) => {
        const o = await open(ctx, { tracker: true });
        if (o.failure) return o.failure;
        const { store } = o.deps;
        const cursor = store.read(DIGEST_KEY);
        const since =
          /** @type {string | undefined} */ (input.since) ??
          (cursor ? JSON.parse(cursor).through : null);
        const applications = listApplications(o.deps, { since });
        const health = precedentHealth(o.deps);
        if (input.mark) {
          const latest =
            applications
              .map((a) => String(a.at))
              .sort()
              .at(-1) ?? since;
          if (latest) store.write(DIGEST_KEY, JSON.stringify({ through: latest }) + '\n');
        }
        return {
          ok: true,
          since,
          applications,
          overruled: applications.filter((a) => a.overruled).length,
          review: health.filter((h) => h.needs_review),
        };
      },
    },
    {
      name: 'rights trust',
      summary:
        'The trust-calibration record per area: escalation worth, precedent-match accuracy, overrules, reversals',
      piece: 'e',
      args: [],
      run: async (_input, ctx) => {
        const o = await open(ctx);
        if (o.failure) return o.failure;
        return { ok: true, areas: trustSummary(readTrustEvents(o.deps.store)) };
      },
    },
    {
      name: 'precedent match',
      summary: 'Candidate precedents for a question, and which still need a judgement of fit',
      piece: 'e',
      args: questionArgs,
      run: async (input, ctx) => {
        const o = await open(ctx);
        if (o.failure) return o.failure;
        const question = questionOf(input, ctx);
        const route = routeQuestion(question, o.deps.policy);
        const match = matchPrecedents(factsOf(question, route), o.deps.precedents.list(), {
          policy: o.deps.policy,
          route,
        });
        return {
          ok: true,
          decider: route.decider,
          basis: route.basis,
          candidates: match.candidates.map((c) => ({
            id: c.id,
            rule: c.precedent.rule,
            needs_judgement: c.needs_judgement,
            judge: c.judge,
          })),
          excluded: match.excluded,
          blocked: match.blocked,
        };
      },
    },
    {
      name: 'judgement weigh',
      summary:
        'Apply judgements as priors to an estimate; a judgement that evidence contradicts is held out and returned as a conflict',
      piece: 'e',
      args: [
        {
          name: 'subject',
          type: 'string',
          description:
            'JSON: { judgements: [{ what, basis, by, at }], confidence?, value?, evidence?: [{ ref, verdict, summary, judgement? }] }',
        },
        FILE_ARG,
      ],
      run: async (input, ctx) => {
        const o = await open(ctx);
        if (o.failure) return o.failure;
        return { ok: true, ...applyPriors(o.deps.policy, jsonInput(input, 'subject', ctx)) };
      },
    },
    {
      name: 'judgement conflict',
      summary:
        'The question that puts contradicting evidence to the person whose judgement it contradicts',
      piece: 'e',
      args: [
        {
          name: 'conflict',
          type: 'string',
          description:
            'JSON: { subject, judgement, evidence, recommend: "keep" | "revise", why, area? }; the result goes to hitld rights ask',
        },
        FILE_ARG,
      ],
      run: (input, ctx) => ({
        ok: true,
        question: conflictQuestion(jsonInput(input, 'conflict', ctx)),
      }),
    },
  ];
  // Decisions are the owner's (Q21, owner 2026-11-14: answers come only from the owner's own turns
  // in the main session). An executor never records, overrules, reverses or rates one, and never
  // asks one: the tracker is the primary checkout's, even from a worktree, and only the
  // orchestrator creates items there. The plugin's Bash guard stops this at the harness, where
  // the agent type is attested; this check is the second line, for headless executors and other
  // harnesses.
  for (const c of commands) {
    if (!EXECUTOR_REFUSED.has(c.name) || !c.run) continue;
    const run = c.run;
    c.run = (input, ctx) => {
      const why = executorSignal(ctx.env, ctx.cwd);
      return why
        ? {
            ok: false,
            error: 'not_permitted',
            message: `${c.name} is ${EXECUTOR_REFUSED.get(c.name)}, through the main session in the primary checkout (${why}); an executor sends questions in its report`,
          }
        : run(input, ctx);
    };
  }
  return commands;
}

/** @type {import('../table.mjs').Command[]} */
export const commands = makeCommands({ openTracker: defaultOpenTracker });
