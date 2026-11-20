import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  descriptionWarnings,
  lintEntity,
  observable,
} from '../lib/tracker/files/descriptions.mjs';
import { compileTerms } from '../lib/guard/private-terms.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { DRAFTS, gradeDrafts, majorityFails } from '../lib/eval/description-fixtures.mjs';
import { itemText, makeRepo, policyFor } from './tracker-fixture.mjs';

/** @param {Record<string, string | string[]>} data @param {string} body */
const rules = (data, body) => lintEntity({ data, body }).map((f) => f.rule);

const GOOD_WORK = [
  '',
  '## Why',
  '',
  'A misspelled key loads silently, so a setting stays off. People editing by hand need to see it.',
  '',
  '## Done when',
  '',
  '- `hitld check policy` refuses an unknown key, naming the key and the line.',
  '- A denial is never retried verbatim.',
  '',
].join('\n');

test('a Done-when line is observable unless it is vague, only says the work is done, or is a stub', () => {
  for (const line of [
    '- `hitld work check` warns on a missing Why.',
    '- A denial is never retried verbatim.',
    '- c1: The last 10 refusals show, newest first.',
    '- Holders queue in arrival order, and a waiting heavy holder is not overtaken.',
    '- The robust parser in core/lib/x.mjs refuses a bad key.',
  ]) {
    assert.equal(observable(line), true, line);
  }
  for (const line of [
    '- It works well.',
    '- Done.',
    '- The feature is implemented.',
    '- Error handling is more robust.',
    '- c1: Performance is better.',
    '- c1: The confidentiality pass and the review are finished.',
  ]) {
    assert.equal(observable(line), false, line);
  }
});

test('a good work item has no findings; a poor one has each mechanical problem', () => {
  assert.deepEqual(rules({ kind: 'work', title: 'Refuse an unknown key' }, GOOD_WORK), []);
  const poor = [
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
  ].join('\n');
  const found = lintEntity({ data: { kind: 'work', title: 'Config' }, body: poor });
  assert.deepEqual(
    found.map((f) => f.rule),
    [
      'missing-why',
      'unobservable-done-when',
      'unobservable-done-when',
      'time-estimate',
      'decision-history',
    ],
  );
  assert.deepEqual(
    found.filter((f) => f.rule === 'unobservable-done-when').map((f) => f.line),
    [4, 5],
    'the lines are body lines',
  );
  assert.equal(found.find((f) => f.rule === 'time-estimate')?.line, 9);
  assert.deepEqual(rules({ kind: 'work', title: 'Empty' }, '\n## Why\n\n<!-- todo -->\n'), [
    'missing-why',
    'missing-done-when',
  ]);
});

test('estimates and history are found in prose only, and a measurement is not an estimate', () => {
  const body = `${GOOD_WORK}\n## Notes\n\nThe setting \`stale_after: 7 days\` is kept. A re-read about a minute later showed it.\n\n\`\`\`\nshould take 3 days\nafter discussion\n\`\`\`\n`;
  assert.deepEqual(rules({ kind: 'work', title: 'T' }, body), []);
  for (const text of [
    'This will take roughly 3 hours.',
    'ETA is Friday.',
    'Five story points.',
    'About ~2 days.',
    'Two days of work.',
  ]) {
    assert.deepEqual(
      rules({ kind: 'work', title: 'T' }, `${GOOD_WORK}\n${text}\n`),
      ['time-estimate'],
      text,
    );
  }
  assert.deepEqual(rules({ kind: 'work', title: 'Should take 2 days' }, GOOD_WORK), [
    'time-estimate',
  ]);
  for (const text of [
    'As discussed, the owner wants it.',
    'Originally we wanted a flag.',
    'This was debated in the meeting.',
  ]) {
    assert.deepEqual(
      rules({ kind: 'work', title: 'T' }, `${GOOD_WORK}\n${text}\n`),
      ['decision-history'],
      text,
    );
  }
  // A decision item records its own question; its history is not checked.
  assert.deepEqual(rules({ kind: 'decision', title: 'Q' }, '\n## Question\n\nAs discussed?\n'), []);
});

test('projects, milestones and external items have their own parts', () => {
  assert.deepEqual(rules({ kind: 'project', title: 'P' }, '\n## Summary\n\n\n'), [
    'missing-summary',
  ]);
  assert.deepEqual(
    rules({ kind: 'project', title: 'P' }, '\n## Summary\n\nThe problem and outcome.\n'),
    [],
  );
  assert.deepEqual(
    rules({ kind: 'external', title: 'E' }, '\n## Waiting on\n\nThe owner signs it.\n'),
    [],
  );
  assert.deepEqual(rules({ kind: 'external', title: 'E' }, '\n## Waiting on\n\n\n'), [
    'missing-waiting-on',
  ]);
  assert.deepEqual(rules({ kind: 'milestone', title: 'M' }, '\n## Notes\n\n\n'), [
    'missing-outcome',
    'missing-clauses',
    'missing-check',
  ]);
  const m = lintEntity({
    data: {
      kind: 'milestone',
      title: 'M',
      outcome: 'A refused dispatch explains itself.',
      done_when: ['c1: Each refusal names its rule.', 'c2: Dashboard work is finished.'],
      check: 'demo: the seeded ledger',
    },
    body: '',
  });
  assert.deepEqual(
    m.map((f) => [f.rule, f.message.split(' has ')[0]]),
    [['unobservable-done-when', 'clause c2']],
  );
});

test('a private term in a draft is a forbidden word, named by kind and line, never the term', () => {
  const terms = compileTerms([{ id: 'T-1', kind: 'host', term: 'secret-host.example' }]);
  const found = lintEntity(
    { data: { kind: 'work', title: 'T' }, body: `${GOOD_WORK}\nDeploy to secret-host.example.\n` },
    { terms },
  );
  assert.deepEqual(
    found.map((f) => f.rule),
    ['forbidden-word'],
  );
  assert.doesNotMatch(JSON.stringify(found), /secret-host/);
});

test('only open entities warn, in the check line format', () => {
  const entry = (/** @type {string} */ state) => ({
    path: `work/items/X-1-${state}.md`,
    file: '',
    folder: 'items',
    data: { id: 'X-1', kind: 'work', state, title: 'T' },
    body: '\n## Done when\n\n- `npm test` passes.\n',
    errors: [],
  });
  assert.deepEqual(descriptionWarnings([entry('done'), entry('dropped')]), []);
  assert.deepEqual(descriptionWarnings([entry('planned')]), [
    'work/items/X-1-planned.md: X-1 description (missing-why): no Why: say what the outcome is and who it serves',
  ]);
});

test('hitld work check gives description findings as warnings, never problems', () => {
  const root = makeRepo({
    commit: false,
    files: {
      'work/items/W-30-vague.md': itemText(
        { id: 'W-30', title: 'Vague', kind: 'work', state: 'proposed', project: 'W-2' },
        '\n## Why\n\nSomething.\n\n## Done when\n\n- It works well.\n',
      ),
    },
  });
  const t = openTracker({ repoRoot: root, policy: policyFor(), env: { HOME: root } });
  const checked = t.check({});
  assert.deepEqual(checked.problems, []);
  assert.ok(
    checked.warnings?.includes(
      'work/items/W-30-vague.md: W-30 description (unobservable-done-when): a Done-when line with nothing to run, see or count: name the command, file, state or number that shows it, body line 8',
    ),
    JSON.stringify(checked.warnings),
  );
});

test('the describe skill names every rule the check has', () => {
  const skill = readFileSync(
    fileURLToPath(new URL('../../skills/describe/SKILL.md', import.meta.url)),
    'utf8',
  );
  for (const rule of Object.keys(RULES)) assert.match(skill, new RegExp(`\`${rule}\``), rule);
});

test('the description-quality fixtures: every seeded poor draft is caught, no control is flagged', () => {
  const graded = gradeDrafts();
  assert.equal(graded.seeded_poor, 4);
  assert.equal(graded.caught, 4);
  assert.equal(graded.false_flags, 0);
  assert.equal(graded.seeded_criteria_found, true);
  assert.equal(graded.judges_independent, true);
  // The unbounded draft passes the check and is caught only by the judge.
  const unbounded = graded.drafts.find((d) => d.id === 'poor-unbounded-work-item');
  assert.deepEqual(unbounded?.rules, []);
  assert.deepEqual(unbounded?.rubric_failed, ['bounded', 'pointed']);
});

test('a judge that is the writer grades nothing, and the majority needs two of three', () => {
  const d = DRAFTS.find((x) => x.id === 'poor-unbounded-work-item');
  assert.ok(d);
  const self = gradeDrafts([{ ...d, recorded: { ...d.recorded, judge: d.writer } }]);
  assert.equal(self.judges_independent, false);
  assert.equal(self.caught, 0, 'its only fault is one the check cannot see');
  const yes = { purpose: true, checkable: true, bounded: true, pointed: true, clean: true };
  assert.deepEqual(majorityFails([{ ...yes, clean: false }, yes, yes]), []);
  assert.deepEqual(majorityFails([{ ...yes, clean: false }, { ...yes, clean: false }, yes]), [
    'clean',
  ]);
});
