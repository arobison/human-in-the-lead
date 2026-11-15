// The stand-alone question (design part 4.2, The decision question) and how its answer is read.
//
// A question stands alone, so it can be answered from a phone without opening anything: the title
// line, the question, the context, the recommendation, the options, the precedent offer, an
// optional tap to say whether it was worth asking, and last the question's check code, which binds
// an answer to the question as shown. The decider can answer `A`, `A yes`, `B just this one`, or
// in words that name one option's label ("enrol it"). A letter is an answer only on its own: alone,
// after "option", before punctuation, or before the reply to the precedent offer; "a different
// idea" is a sentence, not option A. Words that name no option, or more than one, are not an
// answer.

/**
 * @typedef {Record<string, any>} Decision a decision item as in schemas/decision.schema.json
 *
 * @typedef {object} ParsedAnswer
 * @property {number | null} option index into the decision's options, null if no option was named
 * @property {boolean} ambiguous true when the free words fit more than one option's label
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
 * @param {{ blocks?: number, critical_path?: boolean, check?: string | null }} [about] what the item
 *   blocks, when the caller knows, and the question's check code
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
  out.push('', 'Optional, after you answer: was this worth asking? (worth it / not worth asking)');
  if (about.check) out.push('', `Check code: ${about.check}`);
  return out.join('\n') + '\n';
}

/** What may follow a bare letter: the reply to the precedent offer. */
const OFFER_REPLY =
  /^(?:yes|y|no|but|just\s+this|this\s+one\s+only|only\s+this\s+one|only\s+for|narrow|treat\s+(?:it\s+)?the\s+same)\b/i;

/** Words that carry no choice: dropped before a label and the words are compared. */
const FILLER = new Set(['it', 'the', 'a', 'an', 'this', 'that', 'please', 'ok', 'okay']);

/**
 * The words of a phrase, lower case and without punctuation, filler dropped, repeated letters
 * collapsed (so "enroll" and "enrol" agree), and "-ize" and "-our" spelled as "-ise" and "-or".
 * @param {string} text @returns {string[]}
 */
function words(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w))
    .map((w) =>
      w
        .replace(/iz(e|ed|es|ing|ation)$/, 'is$1')
        .replace(/our(s|ed)?$/, 'or$1')
        .replace(/(.)\1+/g, '$1'),
    );
}

/**
 * Whether two words are the same word: equal, or one letter apart in a word of six letters or more
 * (a slip of the keys, not a different word).
 * @param {string} a @param {string} b
 */
function sameWord(a, b) {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.slice(i) === long.slice(i + 1);
}

/**
 * The options whose label the free words name. The words must be the label and nothing else (after
 * filler words and simple spelling variants are set aside), so an added word such as "not" never
 * turns "enrol it" into "do not enrol it".
 * @param {string} text @param {Record<string, any>[]} options @returns {number[]}
 */
export function optionsNamedBy(text, options) {
  const given = words(text);
  if (given.length === 0) return [];
  /** @type {number[]} */
  const hits = [];
  for (const [i, o] of options.entries()) {
    const label = words(String(o.label ?? ''));
    if (label.length === 0 || label.length !== given.length) continue;
    const covers = (/** @type {string[]} */ xs, /** @type {string[]} */ ys) =>
      xs.every((x) => ys.some((y) => sameWord(x, y)));
    if (covers(given, label) && covers(label, given)) hits.push(i);
  }
  return hits;
}

/**
 * Read an answer: an option (by its letter, or by words that name exactly one label), then
 * optionally what the decider says to the precedent offer, then optionally a reason. Words that
 * name no option, or more than one, name none: `option` is null (and `ambiguous` says which).
 * @param {string} text @param {Decision} decision @returns {ParsedAnswer}
 */
export function parseAnswer(text, decision) {
  const given = text.trim();
  const options = /** @type {Record<string, any>[]} */ (decision.options ?? []);
  const count = options.length;
  /** @type {ParsedAnswer} */
  const out = {
    option: null,
    ambiguous: false,
    letter: null,
    generalization: null,
    narrowing: null,
    rationale: given,
    text: given,
  };
  let rest = given;
  // A letter names an option only when it stands alone: the whole answer, after "option", before
  // punctuation, or before the reply to the precedent offer. As the first word of a sentence ("a
  // different idea", "I think so") it is a word.
  const m = /^(?:option\s+)?([A-Za-z])(?![A-Za-z0-9'\u2019])\s*([,:.;!?)-]*)\s*([\s\S]*)$/i.exec(
    given,
  );
  const alone = m !== null && (m[3] === '' || m[2] !== '' || OFFER_REPLY.test(m[3]));
  if (m && alone && m[1].toUpperCase().charCodeAt(0) - 65 < count) {
    out.option = m[1].toUpperCase().charCodeAt(0) - 65;
    rest = m[3];
  } else if (count > 0) {
    // The whole answer, or the words before the first comma, may be an option's label.
    const split = /^([^,;:.]+)[,;:.]\s*([\s\S]*)$/.exec(given);
    for (const [head, tail] of split
      ? [
          [given, ''],
          [split[1], split[2]],
        ]
      : [[given, '']]) {
      const hits = optionsNamedBy(head, options);
      if (hits.length === 1) {
        out.option = hits[0];
        rest = tail;
        break;
      }
      if (hits.length > 1) out.ambiguous = true;
    }
  }
  if (out.option !== null) {
    out.ambiguous = false;
    out.letter = optionLetter(out.option);
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
