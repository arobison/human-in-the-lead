// Actions for the reproducer's scenarios (HITLD-30, design part 2.2, step 3): a fixture consumer
// with a reported bug. The hitld commands go through orchestrator.cli, which runs in consumer/; the
// reproducer's own work (its test file and its reply) is written with file.write, as the agent
// would write it. Every repository is built inside the sandbox; synthetic and public.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildConsumer } from '../orchestrator-fixtures.mjs';

/** The bug: mean() divides by one less than the count. */
const BUGGY = 'export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length - 1);\n';

const PROJECT = [
  '---',
  'id: W-10',
  'title: Reported bugs',
  'kind: project',
  'state: planned',
  'created: 2026-11-20',
  '---',
  '',
  '## Summary',
  '',
].join('\n');

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'reproduce.fixture': {
    description:
      'Build a fixture consumer at consumer/ in the sandbox, committed on main, whose src/stats.js has a reported bug (mean([2, 4]) gives 6), with a project W-10 for its item; and write the bug signal SIG-7 to signal.json. Returns { root, signal, signal_file }.',
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (_input, ctx) => {
      buildConsumer(join(ctx.sandbox, 'consumer'), {
        files: { 'src/stats.js': BUGGY, 'work/projects/W-10-reported-bugs.md': PROJECT },
      });
      const signal = {
        schema_version: 1,
        id: 'SIG-7',
        kind: 'bug',
        state: 'new',
        source: 'github-issues:fixture/consumer',
        received_at: '2026-11-20',
        summary: 'mean() of [2, 4] gives 6 instead of 3.',
        body: 'Calling mean([2, 4]) returns 6. Expected 3.',
        route: null,
        classification: 'public',
      };
      writeFileSync(join(ctx.sandbox, 'signal.json'), `${JSON.stringify(signal, null, 2)}\n`);
      return { root: 'consumer', signal: signal.id, signal_file: 'signal.json' };
    },
  },
};
