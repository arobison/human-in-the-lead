// The knowledge-base commands (design part 8.5): search, index, stale, links and check. `kb orphans`
// and `kb reindex` come later (later.mjs); the hybrid retriever is not built, so search is the
// default grep+index retriever.

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CodedError } from '../errors.mjs';
import { loadPolicy, policyDefaults } from '../../policy/policy.mjs';
import { parsePrecedent, PRECEDENT_DIR } from '../../precedent/store.mjs';
import { openTracker } from '../../tracker/files/tracker.mjs';
import { repoRootOf } from '../../tracker/files/tree.mjs';
import { insidePath, isRegularFile, readNoFollow } from '../../tracker/files/safe.mjs';
import {
  budgetsOf,
  buildDecisions,
  buildIndex,
  checkKnowledgeBase,
  KB_DIR,
  linkProblems,
  loadKnowledgeBase,
  searchKnowledgeBase,
  staleNotes,
  writeGenerated,
} from '../../kb/kb.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} CommandContext
 * @typedef {import('../../kb/kb.mjs').DecisionLine} DecisionLine
 * @typedef {import('../../kb/kb.mjs').PrecedentLine} PrecedentLine
 */

const repoArg = {
  name: 'repo',
  type: /** @type {const} */ ('string'),
  description: 'The repository (default: the one containing the current directory)',
};

/**
 * The repository, its policy (the defaults when it has none) and its knowledge base.
 * @param {Record<string, unknown>} input @param {CommandContext} ctx
 */
function open(input, ctx) {
  const start = input.repo ? resolve(ctx.cwd, String(input.repo)) : ctx.cwd;
  let repoRoot;
  try {
    repoRoot = repoRootOf(start);
  } catch {
    throw new CodedError('usage', `${start} is not in a git repository`);
  }
  const loaded = loadPolicy({ cwd: repoRoot });
  if (loaded.path && !loaded.policy) {
    throw new CodedError(
      'policy',
      `policy.json: ${loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
    );
  }
  const policy = loaded.policy ?? policyDefaults();
  return { repoRoot, policy, budgets: budgetsOf(policy), kb: loadKnowledgeBase(repoRoot) };
}

/**
 * What decisions.md lists: the tracker's answered decisions and the repository's active public
 * precedents. Null, with the reason, when the tracker cannot be read.
 * @param {string} repoRoot @param {Record<string, any>} policy @param {CommandContext} ctx
 * @returns {{ decisions: DecisionLine[], precedents: PrecedentLine[] } | { error: string }}
 */
function decisionSources(repoRoot, policy, ctx) {
  /** @type {DecisionLine[]} */
  let decisions = [];
  try {
    const tracker = openTracker({ repoRoot, policy, env: ctx.env });
    decisions = tracker
      .query({ kind: 'decision', state: 'done' })
      .filter((d) => typeof d.answer === 'string' && d.answer)
      .map((d) => ({
        id: String(d.id),
        title: String(d.title ?? d.id),
        answer: String(d.answer),
        ...(typeof d.answered_at === 'string' ? { answered_at: d.answered_at } : {}),
      }));
  } catch (e) {
    if (existsSync(join(repoRoot, '.human-in-the-lead', 'tracker.json'))) {
      return { error: `the tracker could not be read: ${/** @type {Error} */ (e).message}` };
    }
  }
  /** @type {PrecedentLine[]} */
  const precedents = [];
  const dir = insidePath(repoRoot, PRECEDENT_DIR);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (!/^P-[1-9][0-9]*(-.*)?\.md$/.test(f) || !isRegularFile(join(dir, f))) continue;
      const p = parsePrecedent(readNoFollow(join(dir, f)), f);
      const shown = p.classification === undefined || p.classification === 'public';
      if (p.state === 'active' && shown) precedents.push({ id: p.id, rule: p.rule });
    }
  }
  return { decisions, precedents };
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'kb search',
    summary:
      'Search the knowledge base: each term expanded through kb/glossary.md, ranked by how many terms a note matches, then by matches in its front matter and body. Superseded notes are left out',
    built_by: 'signal',
    output: ['ok', 'terms', 'expanded', 'results', 'count'],
    args: [
      {
        name: 'terms',
        type: 'string',
        description: 'The words to search for, in one argument ("cache invalidation")',
        positional: true,
        required: true,
      },
      { name: 'area', type: 'string', description: 'Only notes in this area' },
      { name: 'tag', type: 'string', description: 'Only notes with this tag' },
      repoArg,
    ],
    run(input, ctx) {
      const terms = String(input.terms).split(/\s+/).filter(Boolean);
      if (!terms.length) throw new CodedError('usage', 'give at least one search term');
      const { kb } = open(input, ctx);
      const found = searchKnowledgeBase(kb, {
        terms,
        ...(input.area ? { area: String(input.area) } : {}),
        ...(input.tag ? { tag: String(input.tag) } : {}),
      });
      return {
        ok: true,
        terms,
        ...found,
        count: found.results.length,
        ...(kb.exists ? {} : { warnings: [`${KB_DIR}/ does not exist in this repository`] }),
      };
    },
  },
  {
    name: 'kb index',
    summary:
      "Regenerate kb/index.md from the notes' front matter, split by area into kb/areas/<area>/index.md when it exceeds kb.index_tokens_max, and kb/decisions.md from the answered decisions and active precedents",
    built_by: 'signal',
    output: ['ok', 'written', 'removed', 'split', 'tokens', 'notes'],
    args: [repoArg],
    run(input, ctx) {
      const { repoRoot, policy, budgets, kb } = open(input, ctx);
      if (!kb.exists) {
        throw new CodedError('usage', `${KB_DIR}/ does not exist in ${repoRoot}; create it first`);
      }
      const index = buildIndex(kb, budgets);
      const sources = decisionSources(repoRoot, policy, ctx);
      if ('error' in sources) throw new CodedError('tracker', sources.error);
      const files = new Map(index.files);
      files.set('decisions.md', buildDecisions(sources.decisions, sources.precedents));
      const done = writeGenerated(kb, files);
      return {
        ok: true,
        ...done,
        split: index.split,
        tokens: index.tokens,
        notes: kb.notes.length,
      };
    },
  },
  {
    name: 'kb stale',
    summary:
      'Knowledge-base notes whose sources changed since checked_at (a checked_at not reachable from HEAD counts as stale), and notes with no sources checked more than kb.max_age_unsourced days ago',
    built_by: 'signal',
    output: ['ok', 'stale', 'count', 'problems'],
    args: [
      {
        name: 'now',
        type: 'string',
        description: 'Judge ages at this time (a timestamp), for tests',
      },
      repoArg,
    ],
    run(input, ctx) {
      const { budgets, kb } = open(input, ctx);
      let now = ctx.now ? ctx.now().getTime() : Date.now();
      if (input.now !== undefined) {
        now = Date.parse(String(input.now));
        if (Number.isNaN(now)) throw new CodedError('usage', '--now is not a timestamp');
      }
      const found = staleNotes(kb, budgets, { now });
      return { ok: true, stale: found.stale, count: found.stale.length, problems: found.problems };
    },
  },
  {
    name: 'kb links',
    summary: 'Broken links in the knowledge base, and links to superseded notes',
    built_by: 'signal',
    output: ['ok', 'problems', 'count'],
    args: [repoArg],
    run(input, ctx) {
      const { kb } = open(input, ctx);
      const problems = linkProblems(kb);
      return { ok: problems.length === 0, problems, count: problems.length };
    },
  },
  {
    name: 'kb check',
    summary:
      'Check the knowledge base: front matter against its schema, the size budgets, links, staleness and whether the generated index is current. Errors fail it (and the merge, in either merge mode); stale notes and an index that is not current are warnings',
    built_by: 'signal',
    output: ['ok', 'errors', 'warnings', 'stale', 'notes'],
    args: [
      {
        name: 'now',
        type: 'string',
        description: 'Judge ages at this time (a timestamp), for tests',
      },
      repoArg,
    ],
    run(input, ctx) {
      const { repoRoot, policy, budgets, kb } = open(input, ctx);
      let now = ctx.now ? ctx.now().getTime() : Date.now();
      if (input.now !== undefined) {
        now = Date.parse(String(input.now));
        if (Number.isNaN(now)) throw new CodedError('usage', '--now is not a timestamp');
      }
      const sources = decisionSources(repoRoot, policy, ctx);
      const result = checkKnowledgeBase(kb, budgets, {
        now,
        ...('error' in sources ? {} : { decisions: sources }),
      });
      return {
        ...result,
        notes: kb.notes.length,
        ...('error' in sources
          ? {
              warnings: [
                ...result.warnings,
                { kind: 'decisions', path: `${KB_DIR}/decisions.md`, message: sources.error },
              ],
            }
          : {}),
      };
    },
  },
];
