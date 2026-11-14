// Actions for the release scenarios: the interface delta between two surfaces, and the bump it
// proposes (design parts 3.2 and 16.5).

import { diffSurface, emptySurface, proposeBump } from '../../release/delta.mjs';

const SURFACE = {
  description:
    'A public interface surface (core/lib/release/surface.mjs); parts left out are empty: schemas, cli, report, trailers, contract, read_api',
  type: 'object',
  properties: {
    schemas: { type: 'object' },
    cli: { type: 'object' },
    report: { type: 'array', items: { type: 'string' } },
    trailers: { type: 'array', items: { type: 'string' } },
    contract: { type: 'string' },
    read_api: { type: 'integer' },
  },
  additionalProperties: false,
};

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'release.propose-bump': {
    description:
      'The interface delta from one surface to another, and the bump it proposes from a base version. Result: { interface_delta, bump, breaking, version, basis }',
    input: {
      type: 'object',
      properties: {
        base_version: { type: 'string' },
        before: SURFACE,
        after: SURFACE,
      },
      required: ['base_version', 'before', 'after'],
      additionalProperties: false,
    },
    run: (input) => {
      const before = { ...emptySurface(), ...input.before };
      const after = { ...emptySurface(), ...input.after };
      const interfaceDelta = diffSurface(before, after);
      return {
        interface_delta: interfaceDelta,
        ...proposeBump(interfaceDelta, input.base_version),
      };
    },
  },
};
