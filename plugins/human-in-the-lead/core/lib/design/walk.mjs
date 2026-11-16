// A design's questions, walked through with the owner one at a time (HITLD-135). This reads the
// questions section of a design file and writes into it only what the owner decided: each answer
// comes from a decision the owner answered and `hitld rights record` filed, never from the caller's
// words, so nothing here can answer a question for the owner.
//
// The format is the one designs 0002 and 0003 use. The questions section is the `## ` heading that
// names questions; each question is a `### Q<n>. <question>` heading; its options are bullets that
// open with a bold "<Kind>: <label>", the recommended one's kind starting with "Recommend"; a
// decided question carries "**Decided by the owner (<date>): <answer>.**" under its heading.

import { describeOption, optionLetter } from '../rights/format.mjs';

/**
 * @typedef {{ letter: string, kind: string, label: string, what_happens: string }} DesignOption
 * @typedef {{
 *   id: string,
 *   question: string,
 *   line: number,
 *   state: 'open' | 'decided',
 *   decided?: { date: string, answer: string, decision: string | null },
 *   context: string,
 *   options: DesignOption[],
 *   recommendation: string | null,
 *   why: string | null,
 * }} DesignQuestion
 * @typedef {{
 *   title: string,
 *   design: string,
 *   status: string | null,
 *   section: { heading: string, number: string | null } | null,
 *   questions: DesignQuestion[],
 * }} Design
 */

const QUESTION = /^### (Q\d+)\.\s+(.+?)\s*$/;
const DECIDED = /^\*\*Decided by the owner \((\d{4}-\d{2}-\d{2})\): (.+?)\*\*(.*)$/;
const RECORDED = /Recorded as ([A-Z][A-Z0-9]*-\d+)\./;
const OPTION = /^- \*\*([^*:]+):\s*(.+?)\*\*(.*)$/;
const STATUS = /^\| \*\*Status\*\* \| (.*) \|\s*$/;

/** The text after a bold label: leading punctuation and spaces dropped. @param {string} rest */
const tidy = (rest) => rest.replace(/^[\s,.;:]+/, '').trim();

/** The section headings that hold a design's questions. @param {string} line */
const isQuestionsHeading = (line) => /^## /.test(line) && /\bquestions?\b/i.test(line);

/**
 * Read a design: its title, status and the questions of its questions section.
 * @param {string} text the design file
 * @param {string} path the file's path, as the questions cite it
 * @returns {Design}
 */
export function readDesign(text, path) {
  const lines = text.split('\n');
  const title = (lines.find((l) => l.startsWith('# ')) ?? '').slice(2).trim();
  const design = /^(\d{4})\b/.exec(title)?.[1] ?? /(\d{4})[^/]*$/.exec(path)?.[1] ?? path;
  const statusLine = lines.find((l) => STATUS.test(l));
  const status = statusLine ? (STATUS.exec(statusLine)?.[1] ?? null) : null;

  // The last section that names questions: a design's own decisions come at its end.
  let start = -1;
  lines.forEach((l, i) => {
    if (isQuestionsHeading(l)) start = i;
  });
  if (start < 0) return { title, design, status, section: null, questions: [] };
  const heading = lines[start].slice(3).trim();
  const number = /^(\d+)\./.exec(heading)?.[1] ?? null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }

  /** @type {DesignQuestion[]} */
  const questions = [];
  for (let i = start + 1; i < end; i++) {
    const q = QUESTION.exec(lines[i]);
    if (!q) continue;
    let j = i + 1;
    while (j < end && !/^###? /.test(lines[j])) j++;
    questions.push(readQuestion(q[1], q[2], i, lines.slice(i + 1, j), { design, path, number }));
    i = j - 1;
  }
  return { title, design, status, section: { heading, number }, questions };
}

/**
 * One question's block.
 * @param {string} id @param {string} question @param {number} line
 * @param {string[]} block the lines under its heading
 * @param {{ design: string, path: string, number: string | null }} where
 * @returns {DesignQuestion}
 */
function readQuestion(id, question, line, block, where) {
  /** @type {DesignQuestion['decided']} */
  let decided;
  /** @type {DesignOption[]} */
  const options = [];
  /** @type {string[]} */
  const prose = [];
  let recommendation = null;
  let why = null;
  for (const l of block) {
    const d = DECIDED.exec(l);
    if (d && !decided) {
      decided = { date: d[1], answer: d[2], decision: RECORDED.exec(d[3])?.[1] ?? null };
      continue;
    }
    const o = OPTION.exec(l);
    if (o) {
      const kind = o[1].trim();
      const label = o[2].trim().replace(/[\s,.;:]+$/, '');
      const what = tidy(o[3]) || label;
      const letter = optionLetter(options.length);
      options.push({ letter, kind, label, what_happens: what });
      if (recommendation === null && /^recommend/i.test(kind)) {
        recommendation = letter;
        why = what;
      }
      continue;
    }
    if (l.trim() && !l.startsWith('- ')) prose.push(l.trim());
  }
  const section = where.number ? `, section ${where.number}` : '';
  const context = [`From design ${where.design} (${where.path}${section}).`, ...prose].join(' ');
  return {
    id,
    question,
    line: line + 1,
    state: decided ? 'decided' : 'open',
    ...(decided ? { decided } : {}),
    context,
    options,
    recommendation,
    why,
  };
}

/** The title a design question's decision carries, which ties the decision to it. @param {string} design @param {DesignQuestion} q */
export const decisionTitle = (design, q) => `Design ${design} ${q.id}: ${q.question}`;

/**
 * The question to put to the owner and record with `hitld rights record`, as the design states it.
 * The caller may shorten the option labels it shows, keeping their order, and then records the
 * labels as shown.
 * @param {Design} d @param {DesignQuestion} q @param {string} path
 * @param {{ parent?: string, classification?: string }} [more] the project the decision is filed
 *   under, and the repository's classification ceiling, which the design's text is under already
 */
export function recordableQuestion(d, q, path, more = {}) {
  return {
    title: decisionTitle(d.design, q),
    question: q.question,
    context: q.context,
    options: q.options.map((o) => ({ label: o.label, what_happens: o.what_happens })),
    ...(q.recommendation
      ? { recommendation: { option: q.recommendation, why: q.why ?? q.question } }
      : {}),
    paths: [path],
    item_kind: 'decision',
    ...(more.classification ? { classification: more.classification } : {}),
    ...(more.parent ? { parent: more.parent } : {}),
  };
}

/**
 * What a design needs before its questions can be put to the owner: each open question needs two
 * options or more and a recommendation, as `rights record` does, and the recommendation first.
 * @param {Design} d
 */
export function problemsOf(d) {
  /** @type {string[]} */
  const problems = [];
  if (!d.section) problems.push('no section heading names questions');
  else if (!d.questions.length)
    problems.push(`section "${d.section.heading}" has no ### Q<n>. headings`);
  for (const q of d.questions) {
    if (q.state !== 'open') continue;
    if (q.options.length < 2) problems.push(`${q.id} has fewer than two options`);
    if (!q.recommendation) problems.push(`${q.id} has no option marked Recommend`);
    // The owner is shown the recommendation first, and the letters follow the design's order.
    else if (q.recommendation !== 'A')
      problems.push(`${q.id} lists its recommendation after another option`);
  }
  return problems;
}

/**
 * The answer a decision records, in the design's words: the design's own label for the option the
 * owner picked (the decision's options are the design's, in order, perhaps shortened), or the
 * owner's own words.
 * @param {Record<string, any>} decision the tracker item
 * @param {DesignQuestion} q
 * @returns {{ ok: true, text: string, option: string | null } | { ok: false, error: string, message: string }}
 */
export function answerInDesign(decision, q) {
  const offered = /** @type {Record<string, any>[]} */ (decision.options ?? []);
  const answer = String(decision.answer ?? '').trim();
  const picked = offered.findIndex((o, i) => describeOption(o, i) === answer);
  if (picked < 0) return { ok: true, text: answer, option: null };
  if (offered.length !== q.options.length) {
    return {
      ok: false,
      error: 'options-differ',
      message: `${decision.id} offered ${offered.length} option(s) and ${q.id} in the design has ${q.options.length}, so the option picked cannot be named in the design's words; nothing was written`,
    };
  }
  return { ok: true, text: q.options[picked].label, option: optionLetter(picked) };
}

/** A sentence ends once. @param {string} text */
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

/**
 * The design with a decided line written under one question's heading.
 * @param {string} text @param {DesignQuestion} q
 * @param {{ date: string, answer: string, decision: string }} decided
 */
export function writeDecided(text, q, decided) {
  const lines = text.split('\n');
  const at = q.line - 1;
  const line = `**Decided by the owner (${decided.date}): ${sentence(decided.answer)}** Recorded as ${decided.decision}.`;
  // The heading, a blank line, the decided line, a blank line, then what was under the heading.
  if (lines[at + 1] === '') lines.splice(at + 2, 0, line, '');
  else lines.splice(at + 1, 0, '', line, '');
  return lines.join('\n');
}

/**
 * The design with its status row saying the owner decided every question.
 * @param {string} text @param {Design} d @param {string} date
 */
export function writeStatusDecided(text, d, date) {
  const section = d.section?.number ? `section ${d.section.number}` : 'the questions section';
  const status = `Decided by the owner (${date}): every question in ${section} is answered.`;
  const lines = text.split('\n');
  const at = lines.findIndex((l) => STATUS.test(l));
  if (at >= 0) lines[at] = `| **Status** | ${status} |`;
  return { text: lines.join('\n'), status, written: at >= 0 };
}
