// Owner judgements as calibrated priors (design parts 3.2, Judgement, and 2.3, shaping).
//
// A judgement is an input: it raises the value and confidence of what it judges, and so raises it
// into shaping. It never settles a bet. Its weight comes from policy.json (`judgement.weights`),
// per person and basis: the owner's gut checks start high, because the owner's experience is real
// evidence. Calibration moves the weights with the record, slowly and with minimum samples; that is
// the milestone Trust calibration, so here the weight is the policy's starting weight.
//
// When evidence contradicts a judgement, neither side wins silently. The judgement is held out of
// the estimate, the conflict is returned, and conflictQuestion puts it to the person who made it,
// with the evidence and a recommendation.

/**
 * @typedef {import('../policy/policy.mjs').Policy} Policy
 * @typedef {{ what: string, basis: 'gut-check' | 'considered', by: string, at?: string }} Judgement
 * @typedef {{ ref: string, verdict: 'contradicts' | 'supports' | 'inconclusive', summary: string, judgement?: number }} Evidence
 *   judgement: the index of the judgement it bears on; omitted, it bears on every one.
 *
 * @typedef {object} Prior
 * @property {number} weight the combined weight of the judgements applied; 0 when none is
 * @property {{ index: number, by: string, basis: string, weight: number }[]} applied
 * @property {{ index: number, by: string, basis: string, weight: number, evidence: Evidence[] }[]} held contradicted: not applied, awaiting the person's answer
 * @property {number | null} confidence the confidence with the prior applied; null if none was given
 * @property {number | null} value likewise
 * @property {{ judgement: number, by: string, what: string, evidence: Evidence[] }[]} conflicts each to be put to its author
 */

/**
 * The starting weight of one judgement: policy.judgement.weights, for the person if listed ("owner",
 * or a contributor ID), otherwise the default.
 * @param {Policy} policy @param {Pick<Judgement, 'by' | 'basis'>} judgement @returns {number}
 */
export function judgementWeight(policy, judgement) {
  const weights = policy.judgement.weights;
  const person = Object.hasOwn(weights, judgement.by) ? weights[judgement.by] : weights.default;
  return person[judgement.basis];
}

/**
 * Apply judgements as priors to an estimate. A judgement that contradicting evidence bears on is
 * held out, never applied and never discarded; the estimate says so by returning it as held.
 * @param {Policy} policy
 * @param {{ judgements?: readonly Judgement[], confidence?: number, value?: number, evidence?: readonly Evidence[] }} subject
 * @returns {Prior}
 */
export function applyPriors(policy, { judgements = [], confidence, value, evidence = [] }) {
  const lift = policy.judgement.lift ?? 0.5;
  /** @type {Prior['applied']} */
  const applied = [];
  /** @type {Prior['held']} */
  const held = [];
  /** @type {Prior['conflicts']} */
  const conflicts = [];
  judgements.forEach((j, index) => {
    const weight = judgementWeight(policy, j);
    const against = evidence.filter(
      (e) => e.verdict === 'contradicts' && (e.judgement === undefined || e.judgement === index),
    );
    if (against.length) {
      held.push({ index, by: j.by, basis: j.basis, weight, evidence: against });
      conflicts.push({ judgement: index, by: j.by, what: j.what, evidence: against });
    } else {
      applied.push({ index, by: j.by, basis: j.basis, weight });
    }
  });
  // Independent inputs combine so that each adds less than the last and the total stays below 1.
  const weight = 1 - applied.reduce((rest, a) => rest * (1 - a.weight), 1);
  const round = (/** @type {number} */ x) => Math.round(x * 10000) / 10000;
  return {
    weight: round(weight),
    applied,
    held,
    confidence:
      confidence === undefined ? null : round(confidence + (1 - confidence) * lift * weight),
    value: value === undefined ? null : round(value * (1 + lift * weight)),
    conflicts,
  };
}

/**
 * The question that puts a conflict to the person whose judgement the evidence contradicts. It is
 * addressed to them, so it goes to them whatever the rights rules say; give it to askQuestion.
 * @param {{
 *   subject: string,
 *   judgement: Judgement,
 *   evidence: readonly Evidence[],
 *   recommend: 'keep' | 'revise',
 *   why: string,
 *   area?: string,
 *   offer?: Record<string, any>,
 * }} input
 *   recommend and why: the system's recommendation, with its reason in one sentence.
 * @returns {Record<string, any>} a question as in schemas/question.schema.json
 */
export function conflictQuestion({ subject, judgement, evidence, recommend, why, area, offer }) {
  const refs = evidence.map((e) => `${e.ref} (${e.summary})`).join('; ');
  return {
    title: `Evidence contradicts a judgement on ${subject}`,
    question: `Does the evidence change your ${judgement.basis} judgement on ${subject}: "${judgement.what}"?`,
    context:
      `${judgement.at ? `On ${judgement.at} the` : 'The'} judgement was recorded as a ${judgement.basis}. Evidence that contradicts it: ${refs}. ` +
      'Until you answer, the estimate is held without your judgement, and nothing has been revised.',
    options: [
      {
        label: 'Keep',
        what_happens:
          'The judgement counts as an input again, and the conflict is recorded with the evidence.',
        reversible: true,
      },
      {
        label: 'Revise',
        what_happens:
          'The estimate follows the evidence. The judgement stays on record, marked as superseded.',
        reversible: true,
      },
    ],
    recommendation: { option: recommend === 'keep' ? 'A' : 'B', why },
    addressed_to: judgement.by,
    triggers: [
      {
        basis: 'conflicting-evidence',
        reason: `evidence ${evidence.map((e) => e.ref).join(', ')} contradicts a judgement`,
      },
    ],
    reversibility: 'two-way',
    ...(area ? { areas: [area] } : {}),
    ...(offer ? { precedent_offer: offer } : {}),
  };
}
