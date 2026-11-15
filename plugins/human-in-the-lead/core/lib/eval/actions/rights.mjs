// Actions for the rights suite's scenarios: owner judgements as priors (design part 3.2,
// Judgement), over data given in the scenario (no store, no clock). The policy is the defaults.

import { applyPriors } from '../../judgement/judgement.mjs';
import { resolvePolicy } from '../../policy/policy.mjs';

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'judgement.weigh': {
    description:
      'Apply judgements as priors to an estimate, under the default policy. Returns the prior as hitld rights judgement weigh does (weight, applied, held, confidence, value, conflicts), and `fields`, the names of every field it returned.',
    input: {
      type: 'object',
      properties: {
        judgements: { type: 'array', items: { type: 'object' } },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        value: { type: 'number', minimum: 0 },
        evidence: { type: 'array', items: { type: 'object' } },
      },
      required: ['judgements'],
      additionalProperties: false,
    },
    run: (input) => {
      const { policy, errors } = resolvePolicy({
        schema_version: 1,
        project: { id: 'scenario', key: 'W' },
      });
      if (!policy) throw new Error(`the default policy is invalid: ${JSON.stringify(errors)}`);
      const prior = applyPriors(policy, /** @type {any} */ (input));
      return { ...prior, fields: Object.keys(prior).sort() };
    },
  },
};
