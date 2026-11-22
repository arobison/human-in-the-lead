// The description-quality eval's fixtures (HITLD-75, design part 17): synthetic signals, the
// entities a writer drafted from them, and a judge's recorded votes on each draft against the
// rubric of the `describe` skill. Some drafts are seeded poor, each with the rubric criteria it
// was written to fail; the rest are good controls.
//
// Offline, the judge's votes are recorded responses replayed (design 17.5: recorded model
// responses replayed for parsing and format checks); a live run asks a judge model for them
// (the `--live` seam, core/lib/eval/live.mjs, not built). The writer and the judge are named by
// model class only. A draft is caught when the deterministic check (descriptions.mjs) warns on
// it or the judge's majority fails it on a criterion. All of it is synthetic and public.

import { lintEntity } from '../tracker/files/descriptions.mjs';

/** The rubric's criteria, in the skill's order. */
export const CRITERIA = Object.freeze(['purpose', 'checkable', 'bounded', 'pointed', 'clean']);

/**
 * @typedef {{ purpose: boolean, checkable: boolean, bounded: boolean, pointed: boolean, clean: boolean }} Vote
 * @typedef {object} Draft
 * @property {string} id
 * @property {string} signal the fixture signal it was drafted from
 * @property {string} writer the writer's model class
 * @property {string[]} seeded the criteria it was written to fail; none for a good control
 * @property {{ data: Record<string, string | string[]>, body: string }} entity
 * @property {{ judge: string, votes: Vote[] }} recorded the judge's model class and its three votes
 */

/** @type {Record<string, string>} */
export const SIGNALS = {
  'SIG-F1':
    'Issue: a policy file with a misspelled key loads without any error, and the setting it meant to change stays off.',
  'SIG-F2': 'Issue: the dashboard shows no reason when a dispatch is refused.',
  'SIG-F3': 'Owner note: the weekly digest should say how many questions executors sent back.',
};

const pass = /** @type {Vote} */ ({
  purpose: true,
  checkable: true,
  bounded: true,
  pointed: true,
  clean: true,
});
/** @param {Partial<Vote>} v @returns {Vote} */
const vote = (v) => ({ ...pass, ...v });

/** @type {Draft[]} */
export const DRAFTS = [
  {
    id: 'good-work-item',
    signal: 'SIG-F1',
    writer: 'writer-a',
    seeded: [],
    entity: {
      data: {
        id: 'F-1',
        kind: 'work',
        state: 'proposed',
        title: 'An unknown policy key is refused',
      },
      body: [
        '',
        '## Why',
        '',
        'A misspelled key in `policy.json` loads silently, so a setting stays off without notice. People who edit the file by hand need to see the mistake where they made it.',
        '',
        '## Done when',
        '',
        '- `hitld check policy` refuses a policy file with an unknown key, naming the key and the line.',
        '- A test loads a fixture with a misspelled key and asserts the refusal.',
        '',
        '## Plan',
        '',
        'Design 3.4, "Extension by declaration": unknown keys are errors.',
        '',
      ].join('\n'),
    },
    recorded: { judge: 'judge-b', votes: [pass, pass, pass] },
  },
  {
    id: 'poor-vague-work-item',
    signal: 'SIG-F1',
    writer: 'writer-a',
    seeded: ['purpose', 'checkable', 'clean'],
    entity: {
      data: { id: 'F-2', kind: 'work', state: 'proposed', title: 'Config improvements' },
      body: [
        '',
        '## Done when',
        '',
        '- Config handling is more robust.',
        '- Validation is implemented.',
        '',
        '## Notes',
        '',
        'After discussion on the call we agreed this should take about two days.',
        '',
      ].join('\n'),
    },
    recorded: {
      judge: 'judge-b',
      votes: [
        vote({ purpose: false, checkable: false, clean: false }),
        vote({ purpose: false, checkable: false, clean: false }),
        vote({ purpose: false, checkable: false, bounded: false, clean: false }),
      ],
    },
  },
  {
    id: 'poor-unbounded-work-item',
    signal: 'SIG-F2',
    writer: 'writer-a',
    // The deterministic check finds nothing here: every part is present and each line names a
    // command. Only the judge can see that the scope has no edge.
    seeded: ['bounded', 'pointed'],
    entity: {
      data: {
        id: 'F-3',
        kind: 'work',
        state: 'proposed',
        title: 'Dispatch refusals on the dashboard',
      },
      body: [
        '',
        '## Why',
        '',
        'People reading the dashboard cannot see why a dispatch was refused.',
        '',
        '## Done when',
        '',
        '- `hitld dashboard` shows every refusal reason, and anything else about dispatch that might help.',
        '',
      ].join('\n'),
    },
    recorded: {
      judge: 'judge-b',
      votes: [
        vote({ bounded: false, pointed: false }),
        vote({ bounded: false }),
        vote({ bounded: false, pointed: false }),
      ],
    },
  },
  {
    id: 'good-milestone',
    signal: 'SIG-F2',
    writer: 'writer-a',
    seeded: [],
    entity: {
      data: {
        id: 'F-4',
        kind: 'milestone',
        state: 'proposed',
        title: 'A refused dispatch explains itself',
        outcome:
          'Anyone reading the dashboard can tell why a dispatch was refused and what would change it.',
        done_when: [
          'c1: Each refusal on the dashboard names its rule and the setting that would change it.',
          'c2: The last 10 refusals show, newest first.',
        ],
        check:
          'integration-test: a seeded ledger with three refusals renders all three with their rules',
      },
      body: '\n## Notes\n\nDesign 7, the dashboard.\n',
    },
    recorded: { judge: 'judge-b', votes: [pass, pass, pass] },
  },
  {
    id: 'poor-milestone',
    signal: 'SIG-F2',
    writer: 'writer-a',
    seeded: ['purpose', 'checkable'],
    entity: {
      data: {
        id: 'F-5',
        kind: 'milestone',
        state: 'proposed',
        title: 'Dashboard phase',
        done_when: ['c1: Dashboard work is finished.'],
      },
      body: '\n## Notes\n\n\n',
    },
    recorded: {
      judge: 'judge-b',
      votes: [
        vote({ purpose: false, checkable: false }),
        vote({ purpose: false, checkable: false, pointed: false }),
        vote({ purpose: false, checkable: false }),
      ],
    },
  },
  {
    id: 'good-project',
    signal: 'SIG-F3',
    writer: 'writer-a',
    seeded: [],
    entity: {
      data: {
        id: 'F-6',
        kind: 'project',
        state: 'proposed',
        title: 'Executor questions in the digest',
      },
      body: '\n## Summary\n\nThe owner cannot see how often executors had to ask what an item meant. When this is done, the weekly digest counts the questions sent back per item, so unclear descriptions show up.\n',
    },
    recorded: { judge: 'judge-b', votes: [pass, pass, pass] },
  },
  {
    id: 'poor-project',
    signal: 'SIG-F3',
    writer: 'writer-a',
    seeded: ['purpose'],
    entity: {
      data: { id: 'F-7', kind: 'project', state: 'proposed', title: 'Digest' },
      body: '\n## Summary\n\n\n',
    },
    recorded: {
      judge: 'judge-b',
      votes: [
        vote({ purpose: false }),
        vote({ purpose: false }),
        vote({ purpose: false, bounded: false }),
      ],
    },
  },
];

/**
 * The majority of three votes, per criterion: the criteria the draft fails.
 * @param {Vote[]} votes @returns {string[]}
 */
export function majorityFails(votes) {
  return CRITERIA.filter(
    (c) =>
      votes.filter((v) => !(/** @type {Record<string, boolean>} */ (v)[c])).length * 2 >
      votes.length,
  );
}

/**
 * Grade every draft: the deterministic check's rules, the judge's majority, whether it was caught,
 * and whether the judge is a different model from the writer. A draft whose judge is its writer is
 * not graded (design 17.3: a different model from the one under test).
 * @param {Draft[]} [drafts]
 */
export function gradeDrafts(drafts = DRAFTS) {
  const graded = drafts.map((d) => {
    const independent = d.recorded.judge !== d.writer;
    const rules = lintEntity(d.entity).map((f) => f.rule);
    const failed = independent ? majorityFails(d.recorded.votes) : [];
    const poor = d.seeded.length > 0;
    const flagged = rules.length > 0 || failed.length > 0;
    return {
      id: d.id,
      kind: String(d.entity.data.kind),
      seeded_poor: poor,
      rules,
      rubric_failed: failed,
      seeded_criteria_found: d.seeded.every((c) => failed.includes(c)),
      caught: poor && flagged,
      false_flag: !poor && flagged,
      judge_independent: independent,
    };
  });
  return {
    drafts: graded,
    seeded_poor: graded.filter((g) => g.seeded_poor).length,
    caught: graded.filter((g) => g.caught).length,
    by_check: graded.filter((g) => g.seeded_poor && g.rules.length > 0).length,
    false_flags: graded.filter((g) => g.false_flag).length,
    seeded_criteria_found: graded.every((g) => g.seeded_criteria_found),
    judges_independent: graded.every((g) => g.judge_independent),
  };
}
