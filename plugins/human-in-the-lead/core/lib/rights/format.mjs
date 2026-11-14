// The stand-alone question (design part 4.2, The decision question) and how its answer is read.
//
// A question stands alone, so it can be answered from a phone without opening anything: the title
// line, the question, the context, the recommendation, the options, and the precedent offer as
// the last line. The decider can answer `A`, `A yes`, `B just this one`, or in free text.

/**
 * @typedef {Record<string, any>} Decision a decision item as in schemas/decision.schema.json
 *
 * @typedef {object} ParsedAnswer
 * @property {number | null} option index into the decision's options, null if no option was named
 * @property {string | null} letter
 * @property {'yes' | 'narrowed' | 'just-this-one' | null} generalization null when the decider did not say
 * @property {string | null} narrowing for narrowed: what they narrowed it to
 * @property {string} rationale the rest of the answer
 * @property {string} text the answer as given
 */

import { describeOffer } from './offer.mjs';

const WIDTH = 78;

/** @param {number} i */
export const optionLetter = (i) => String.fromCharCode(65 + i);

/**
 * Word-wrap text, the first line prefixed by `first` and the rest by `rest`.
 * @param {string} text @param {string} first @param {string} rest
 */
function wrap(text, first, rest) {
  /** @type {string[]} */
  const lines = [];
  let line = first;
  let empty = true;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!empty && line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = rest + word;
    } else {
      line += (empty ? '' : ' ') + word;
    }
    empty = false;
  }
  lines.push(line);
  return lines.join('\n');
}

/**
 * One option as the question and the recorded answer show it.
 * @param {Record<string, any>} option @param {number} i @param {boolean} [withCost]
 */
export function describeOption(option, i, withCost = false) {
  const letter = optionLetter(i);
  const head = option.label === letter ? '' : `${option.label}: `;
  const cost = withCost && option.cost ? `; ${option.cost}` : '';
  return `${letter}. ${head}${option.what_happens}${cost}`;
}

/**
 * The option a recommendation or answer names, by letter or by label.
 * @param {Decision} decision @param {string} name @returns {number | null}
 */
export function optionIndex(decision, name) {
  const options = /** @type {Record<string, any>[]} */ (decision.options ?? []);
  const n = name.trim().toLowerCase();
  const byLetter = options.findIndex((_, i) => optionLetter(i).toLowerCase() === n);
  if (byLetter >= 0) return byLetter;
  const byLabel = options.findIndex((o) => String(o.label).toLowerCase() === n);
  return byLabel >= 0 ? byLabel : null;
}

/**
 * Render a decision as the question the decider reads.
 * @param {Decision} decision
 * @param {{ blocks?: number, critical_path?: boolean }} [about] what the item blocks, when the caller knows
 * @returns {string}
 */
export function formatQuestion(decision, about = {}) {
  const head = [
    'Decision',
    ...(about.blocks
      ? [
          `blocks ${about.blocks} item${about.blocks === 1 ? '' : 's'}${about.critical_path ? ' on the critical path' : ''}`,
        ]
      : []),
    ...(decision.reversibility
      ? [`${decision.reversibility === 'one-way' ? 'one' : 'two'}-way door`]
      : []),
  ].join(' · ');
  /** @type {string[]} */
  const out = [`${decision.id}  ${head}`, '', wrap(decision.question, '', ''), ''];
  if (decision.context) out.push(wrap(decision.context, 'Context: ', ''), '');
  if (decision.recommendation) {
    const i = optionIndex(decision, decision.recommendation.option);
    const pick = i === null ? decision.recommendation.option : `${optionLetter(i)}.`;
    out.push(wrap(`${pick} ${decision.recommendation.why}`, 'Recommend: ', ''), '');
  }
  for (const [i, o] of (decision.options ?? []).entries()) {
    out.push(wrap(describeOption(o, i, true), '  ', '     '));
  }
  if (decision.precedent_offer) {
    out.push(
      '',
      wrap(
        `Future cases like this (${decision.precedent_offer.summary}): treat the same way? (yes / just this one)`,
        '',
        '',
      ),
      ...describeOffer(decision.precedent_offer, decision.decider ?? '').map((l) =>
        wrap(l.trim(), '  ', '    '),
      ),
    );
  }
  return out.join('\n') + '\n';
}

/**
 * Read an answer: an option, then optionally what the decider says to the precedent offer, then
 * a reason. Free text with no option is returned as a rationale for the caller to settle.
 * @param {string} text @param {Decision} decision @returns {ParsedAnswer}
 */
export function parseAnswer(text, decision) {
  const given = text.trim();
  const count = (decision.options ?? []).length;
  /** @type {ParsedAnswer} */
  const out = {
    option: null,
    letter: null,
    generalization: null,
    narrowing: null,
    rationale: given,
    text: given,
  };
  let rest = given;
  const m = /^([A-Za-z])(?![A-Za-z0-9])\s*[,:.;-]?\s*([\s\S]*)$/.exec(given);
  if (m && m[1].toUpperCase().charCodeAt(0) - 65 < count) {
    out.option = m[1].toUpperCase().charCodeAt(0) - 65;
    out.letter = m[1].toUpperCase();
    rest = m[2];
  }
  const sep = /^[\s,;:.-]*/;
  /** @param {RegExp} re */
  const take = (re) => {
    const hit = re.exec(rest);
    if (hit) rest = rest.slice(hit[0].length).replace(sep, '');
    return hit;
  };
  let hit;
  if (
    (hit = take(
      /^(?:yes,?\s*)?(?:but\s+)?(?:narrow(?:ed)?(?:\s+it)?(?:\s+to)?|only\s+for)\s*[:,-]?\s*([^.\n]+)/i,
    ))
  ) {
    out.generalization = 'narrowed';
    out.narrowing = hit[1].trim();
  } else if (take(/^(?:just\s+this\s+one|just\s+this|this\s+one\s+only|only\s+this\s+one|no)\b/i)) {
    out.generalization = 'just-this-one';
  } else if (take(/^(?:yes|y|treat\s+(?:it\s+)?the\s+same)\b/i)) {
    out.generalization = 'yes';
  }
  out.rationale = out.option === null && out.generalization === null ? given : rest.trim();
  return out;
}
