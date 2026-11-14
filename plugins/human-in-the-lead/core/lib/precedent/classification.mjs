// Comparing classifications (design part 3.2) so that a value nobody recognizes is never trusted:
// an unknown or missing classification ranks as the most restrictive, and never counts as fit to
// cite or to store somewhere less restricted.

const RANKS = Object.freeze({ public: 0, internal: 1, confidential: 2, secret: 3 });

/** @param {unknown} c @returns {c is keyof typeof RANKS} */
export const isKnownClassification = (c) => typeof c === 'string' && Object.hasOwn(RANKS, c);

/** The rank of a classification; 3, the most restrictive, when it is unknown or missing. @param {unknown} c */
export const rank = (c) => (isKnownClassification(c) ? RANKS[c] : RANKS.secret);

/**
 * Whether something classified `inner` may appear in something classified `outer`: both must be
 * known, and inner no more restricted than outer.
 * @param {unknown} inner @param {unknown} outer
 */
export const mayAppearIn = (inner, outer) =>
  isKnownClassification(inner) && isKnownClassification(outer) && rank(inner) <= rank(outer);

/**
 * Whether `a` is more confidential than `b`: true if either is unknown.
 * @param {unknown} a @param {unknown} b
 */
export const moreRestrictedThan = (a, b) =>
  !isKnownClassification(a) || !isKnownClassification(b) || rank(a) > rank(b);
