// Actions for the design suite's scenarios (HITLD-135): read a design file in the sandbox, so the
// graders check the file a walk-through edited, line by line.

import { readSandboxFile, sandboxPath } from '../util.mjs';

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'design.read': {
    description:
      'Read a text file in the sandbox. Returns `text`, its `lines`, the `decided` lines ("**Decided by the owner ...") in order, and the `status` row, or null.',
    input: {
      type: 'object',
      properties: { path: { type: 'string', minLength: 1 } },
      required: ['path'],
      additionalProperties: false,
    },
    run: ({ path }, ctx) => {
      const text = readSandboxFile(sandboxPath(ctx.sandbox, path));
      const lines = text.split('\n');
      return {
        text,
        lines,
        decided: lines.filter((l) => l.startsWith('**Decided by the owner')),
        status: lines.find((l) => l.startsWith('| **Status** |')) ?? null,
      };
    },
  },
};
