// Actions for the contract scenarios (piece d): install the block and parse a report.

import { installBlock } from '../../contract/block.mjs';
import { loadPolicy } from '../../policy/policy.mjs';
import { parseReport } from '../../contract/report.mjs';

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'contract.install': {
    description:
      'Write or update the executor contract block in the sandbox AGENTS.md. Result: { ok, action }',
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (_input, ctx) => {
      const key = loadPolicy({ cwd: ctx.sandbox }).policy?.project?.key;
      const { ok, action } = installBlock(ctx.sandbox, undefined, key);
      return { ok, action };
    },
  },
  'report.parse': {
    description: 'Parse an executor report text. Result: { report, errors }',
    input: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    run: (input) => parseReport(input.text),
  },
};
