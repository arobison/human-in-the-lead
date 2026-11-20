// Actions for the tracker scenarios: build the fixture tracker the stale-item sweep reads (design
// part 13.3). The hitld commands themselves go through orchestrator.cli, which runs in consumer/
// with the sandbox's data home, where the fixture's ledger is. Every repository is built inside
// the sandbox.

import { join } from 'node:path';
import { gradeDrafts } from '../description-fixtures.mjs';
import { buildSweepConsumer } from '../orchestrator-fixtures.mjs';

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'tracker.sweep-fixture': {
    description:
      'Build the stale-item sweep fixture at consumer/ in the sandbox, committed on main, with its ledger in the private store under data/: one case of each finding kind and one beside it that is not a finding (core/lib/eval/orchestrator-fixtures.mjs, buildSweepConsumer). Returns { root, project, now }: now is the time to judge it at.',
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (_input, ctx) => {
      const made = buildSweepConsumer(join(ctx.sandbox, 'consumer'), join(ctx.sandbox, 'data'));
      return { root: 'consumer', project: made.project, now: made.now };
    },
  },
  'tracker.description-grade': {
    description:
      "Grade the description-quality fixtures (core/lib/eval/description-fixtures.mjs): each entity drafted from a fixture signal is checked by the deterministic description check and graded against the describe skill's rubric by the majority of a different model's three votes, recorded and replayed offline. Returns { drafts, seeded_poor, caught, by_check, false_flags, seeded_criteria_found, judges_independent }.",
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: () => gradeDrafts(),
  },
};
