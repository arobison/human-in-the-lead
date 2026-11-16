// `hitld design` (HITLD-135): a design's open questions, walked through with the owner one at a
// time by the design skill. `design questions` reads them; the skill puts each to the owner and
// records the choice with `hitld rights record`; `design answer` writes the recorded answer under
// its question; `design decide` marks the design decided once every question is answered. The
// library is core/lib/design/walk.mjs.
//
// Only an answered decision of the owner's is written into a design, never words the caller
// gives, so a question the owner skipped stays open and nothing here answers for the owner.

import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import {
  answerInDesign,
  decisionTitle,
  problemsOf,
  readDesign,
  recordableQuestion,
  writeDecided,
  writeStatusDecided,
} from '../../design/walk.mjs';
import { CodedError } from '../errors.mjs';
import { executorSignal } from '../executor.mjs';
import { openDecisions } from './rights.mjs';
import { readAsked } from '../../rights/flow.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 */

const FILE = {
  name: 'file',
  type: /** @type {const} */ ('string'),
  description: 'The design file, a Markdown file in this repository',
  required: true,
};

/**
 * The design file: inside the repository, read whole.
 * @param {unknown} given @param {Ctx} ctx
 */
function openDesign(given, ctx) {
  const full = resolve(ctx.cwd, String(given));
  const root = findRepoRoot(ctx.cwd) ?? ctx.cwd;
  const rel = relative(root, full);
  if (!full.endsWith('.md') || rel.startsWith('..') || isAbsolute(rel)) {
    throw new CodedError('usage', `${String(given)} is not a Markdown file in this repository`);
  }
  /** @type {string} */
  let text;
  try {
    text = readFileSync(full, 'utf8');
  } catch {
    throw new CodedError('not-found', `${String(given)} cannot be read`);
  }
  const path = rel.split(sep).join('/');
  return { full, path, text, design: readDesign(text, path) };
}

/** The owner's commands are refused to an executor. @param {string} name @param {Ctx} ctx */
function refuseExecutor(name, ctx) {
  const why = executorSignal(ctx.env, ctx.cwd);
  return why
    ? {
        ok: false,
        error: 'not-permitted',
        message: `hitld ${name} writes the owner's decisions into a design, so it is the orchestrator's or the chief of staff's (${why})`,
      }
    : null;
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'design questions',
    summary:
      "A design's questions, in order: each open one with its options and recommendation as the design states them, and the question to record with hitld rights record once the owner chooses",
    built_by: 'e',
    output: [
      'ok',
      'file',
      'design',
      'status',
      'section',
      'open',
      'decided',
      'questions',
      'problems',
    ],
    args: [
      FILE,
      {
        name: 'parent',
        type: 'string',
        description:
          'The project the decisions are filed under, written into each question to record',
      },
    ],
    run(input, ctx) {
      const { path, design: d } = openDesign(input.file, ctx);
      const parent = typeof input.parent === 'string' ? input.parent : undefined;
      // The design is in the repository, so its questions are no more confidential than it is.
      const classification = loadPolicy({ cwd: ctx.cwd }).policy?.project.classification_ceiling;
      const problems = problemsOf(d);
      const questions = d.questions.map((q) =>
        q.state === 'decided'
          ? { id: q.id, question: q.question, state: q.state, decided: q.decided }
          : {
              id: q.id,
              question: q.question,
              state: q.state,
              options: q.options,
              recommendation: q.recommendation,
              record: recordableQuestion(d, q, path, { parent, classification }),
            },
      );
      return {
        ok: problems.length === 0,
        ...(problems.length ? { error: 'not-a-design' } : {}),
        file: path,
        design: d.design,
        status: d.status,
        section: d.section,
        open: d.questions.filter((q) => q.state === 'open').length,
        decided: d.questions.filter((q) => q.state === 'decided').length,
        questions,
        problems,
        ...(problems.length
          ? {
              message: `the design's questions cannot be put as they stand: ${problems.join('; ')}`,
            }
          : {}),
      };
    },
  },
  {
    name: 'design answer',
    summary:
      "Write the owner's answer under one question of a design, from the decision hitld rights record filed for it: the design's label for the option picked, or the owner's own words, with the date and the decision's ID",
    built_by: 'e',
    output: ['ok', 'file', 'question', 'decision', 'option', 'line', 'open', 'message'],
    args: [
      FILE,
      { name: 'question', type: 'string', description: 'The question, as Q<n>', required: true },
      {
        name: 'decision',
        type: 'string',
        description: 'The decision hitld rights record filed for it, answered by the owner',
        required: true,
      },
    ],
    async run(input, ctx) {
      const refused = refuseExecutor('design answer', ctx);
      if (refused) return refused;
      const { full, path, text, design: d } = openDesign(input.file, ctx);
      const id = String(input.question).toUpperCase();
      const q = d.questions.find((x) => x.id === id);
      if (!q) {
        return { ok: false, error: 'not-found', message: `${path} has no question ${id}` };
      }
      if (q.state === 'decided') {
        return {
          ok: false,
          error: 'already-decided',
          decided: q.decided,
          message: `${id} is decided already; nothing was written`,
        };
      }
      const o = await openDecisions(ctx);
      if (o.failure) return o.failure;
      /** @type {Record<string, any>} */
      let decision;
      try {
        decision = o.deps.tracker.get(String(input.decision));
      } catch {
        return {
          ok: false,
          error: 'not-found',
          message: `${input.decision} is not in the tracker`,
        };
      }
      if (decision.kind !== 'decision') {
        return { ok: false, error: 'not-a-decision', message: `${decision.id} is not a decision` };
      }
      const title = decisionTitle(d.design, q);
      if (decision.title !== title) {
        return {
          ok: false,
          error: 'decision-not-for-question',
          expected_title: title,
          message: `${decision.id} is titled "${decision.title}", not "${title}", so it is not the owner's answer to ${id}; nothing was written`,
        };
      }
      if (decision.state !== 'done' || !decision.answer || decision.answered_by !== 'owner') {
        return {
          ok: false,
          error: 'not-answered',
          message: `${decision.id} has no answer from the owner, so ${id} stays open; nothing was written`,
        };
      }
      // The options the owner was shown: the item's own, or, where the backend keeps them as text
      // (the files backend), the ones recorded when it was asked.
      const options = decision.options ?? readAsked(o.deps.store, decision.id)?.options;
      const answer = answerInDesign({ ...decision, options }, q);
      if (!answer.ok) return answer;
      const date = String(decision.answered_at ?? '').slice(0, 10);
      writeFileSync(
        full,
        writeDecided(text, q, { date, answer: answer.text, decision: decision.id }),
      );
      const open = d.questions.filter((x) => x.state === 'open' && x.id !== id).map((x) => x.id);
      return {
        ok: true,
        file: path,
        question: id,
        decision: decision.id,
        option: answer.option,
        line: q.line,
        open,
        message: open.length
          ? `${id} is decided in ${path}; ${open.length} question(s) still open: ${open.join(', ')}`
          : `${id} is decided in ${path}; every question is answered, so hitld design decide marks it decided`,
      };
    },
  },
  {
    name: 'design decide',
    summary:
      'Mark a design decided once the owner has answered every question in it: its status row says so. Refused while any question is open',
    built_by: 'e',
    output: ['ok', 'file', 'design', 'status', 'decisions', 'open', 'message'],
    args: [FILE],
    run(input, ctx) {
      const refused = refuseExecutor('design decide', ctx);
      if (refused) return refused;
      const { full, path, text, design: d } = openDesign(input.file, ctx);
      const problems = problemsOf(d).filter((p) => !/^Q\d+ /.test(p));
      if (problems.length) {
        return { ok: false, error: 'not-a-design', problems, message: problems.join('; ') };
      }
      const open = d.questions.filter((q) => q.state === 'open').map((q) => q.id);
      if (open.length) {
        return {
          ok: false,
          error: 'questions-open',
          open,
          message: `${open.length} question(s) in ${path} wait for the owner: ${open.join(', ')}. The design stays undecided; nothing was written`,
        };
      }
      const dates = d.questions.map((q) => q.decided?.date ?? '').sort();
      const date = dates[dates.length - 1];
      const written = writeStatusDecided(text, d, date);
      if (written.written) writeFileSync(full, written.text);
      return {
        ok: true,
        file: path,
        design: d.design,
        status: written.status,
        decisions: d.questions.map((q) => ({
          question: q.id,
          decision: q.decided?.decision ?? null,
        })),
        open: [],
        message: written.written
          ? `${path} is marked decided`
          : `every question in ${path} is answered, and it has no status row to mark`,
      };
    },
  },
];
