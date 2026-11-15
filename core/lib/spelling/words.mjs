// The British spellings the spelling check refuses, and the American form of each. The project
// writes American English. A rule matches one lower-case word piece: a run of letters in a text,
// split at camelCase humps, so `judgementWeight` and `needs_judgement` are found too. The list is
// short on purpose: it names the forms the project has had, not every difference. Words people
// type are matched by the question matcher (core/lib/rights/format.mjs), which treats the two
// spellings as one.

/**
 * @typedef {object} Rule
 * @property {RegExp} match the whole lower-case piece
 * @property {(piece: string) => string} american the piece in American spelling
 */

/** The `-ise` family. Each stem is a word of its own, so `otherwise` and `promise` are left alone. */
const IZE_STEMS = [
  'normal',
  'recogn',
  'organ',
  'optim',
  'summar',
  'priorit',
  'minim',
  'maxim',
  'custom',
  'serial',
  'initial',
  'author',
  'util',
  'synchron',
  'sanit',
  'general',
  'special',
  'final',
  'categor',
  'emphas',
  'apolog',
  'real',
  'local',
  'central',
  'capital',
  'material',
  'memor',
  'familiar',
  'formal',
  'standard',
  'visual',
  'moderni',
  'stabil',
  'symbol',
  'theor',
  'harmon',
  'neutral',
  'rational',
  'legit',
  'mobil',
  'digit',
  'scrutin',
  'character',
  'critic',
  'equal',
  'ideal',
  'personal',
  'popular',
  'public',
];

/** The `-our` words: `behaviour`, `honoured`, `favourite`, `neighbourhood`. */
const OR_STEMS = [
  'behaviour',
  'labour',
  'honour',
  'favour',
  'colour',
  'neighbour',
  'flavour',
  'humour',
  'rumour',
  'harbour',
];

const OR_ENDINGS = '(?:s|ed|ing|er|ers|al|able|ite|ites|hood|ly)?';

export const RULES = Object.freeze(
  /** @type {Rule[]} */ ([
    { match: /^(?:un|re)?enrol(?:s|ment|ments)?$/, american: (p) => p.replace('enrol', 'enroll') },
    { match: /^judgements?$/, american: (p) => p.replace('judgement', 'judgment') },
    { match: /^licen(?:ce|ces|ced|cing)$/, american: (p) => p.replace('licenc', 'licens') },
    {
      match: new RegExp(`^(?:${OR_STEMS.join('|')})${OR_ENDINGS}$`),
      american: (p) => p.replace('our', 'or'),
    },
    {
      match: /^(?:cancell|travell|modell|labell)(?:ed|ing|er|ers)$/,
      american: (p) => p.replace('ll', 'l'),
    },
    { match: /^(?:defence|offence|pretence)s?$/, american: (p) => p.replace('ence', 'ense') },
    { match: /^programmes?$/, american: (p) => p.replace('programme', 'program') },
    { match: /^artefacts?$/, american: (p) => p.replace('artefact', 'artifact') },
    { match: /^fulfil$/, american: () => 'fulfill' },
    { match: /^whilst$/, american: () => 'while' },
    { match: /^amongst$/, american: () => 'among' },
    { match: /^learnt$/, american: () => 'learned' },
    {
      match: new RegExp(`^(?:${IZE_STEMS.join('|')})(?:ise|ises|ised|ising|isation|isations)$`),
      american: (p) => p.replace(/is(e|es|ed|ing|ation|ations)$/, 'iz$1'),
    },
    {
      match: /^(?:analy|paraly|catalys)(?:se|sed|sing|ser|sers)$/,
      american: (p) => p.replace(/s(e|ed|ing|er|ers)$/, 'z$1'),
    },
  ]),
);

/**
 * The American form of a word piece, or null when it is not on the list.
 * @param {string} piece
 * @returns {string | null}
 */
export function americanOf(piece) {
  const lower = piece.toLowerCase();
  for (const rule of RULES) if (rule.match.test(lower)) return rule.american(lower);
  return null;
}

/**
 * Split a run of letters at camelCase humps: `judgementWeight` is `judgement` and `Weight`.
 * @param {string} run
 * @returns {string[]}
 */
export const piecesOf = (run) => run.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);

/**
 * `american` in the case of `piece`: all capitals stay capitals, an initial capital stays one.
 * @param {string} piece @param {string} american
 */
export function sameCase(piece, american) {
  if (piece.length > 1 && piece === piece.toUpperCase()) return american.toUpperCase();
  if (piece[0] !== piece[0].toLowerCase()) return american[0].toUpperCase() + american.slice(1);
  return american;
}

/**
 * A text with every listed British word in American spelling, case kept.
 * @param {string} text
 * @returns {string}
 */
export function americanize(text) {
  return text.replace(/[A-Za-z]+/g, (run) =>
    piecesOf(run)
      .map((piece) => {
        const a = americanOf(piece);
        return a === null ? piece : sameCase(piece, a);
      })
      .join(''),
  );
}
