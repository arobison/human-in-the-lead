// A design's questions walked through with the owner one at a time (HITLD-135): each answer is the
// owner's recorded decision, written under its question in the design's words; a skipped question
// stays open, and the design is decided only when every question is answered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../lib/cli/main.mjs';
import { problemsOf, readDesign, writeDecided } from '../lib/design/walk.mjs';
import { isolatedEnv, itemText, makeRepo, put } from './tracker-fixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const POLICY = JSON.stringify({ schema_version: 1, project: { id: 'fixture', key: 'W' } });
const FILE = 'docs/design/0009-report-colors.md';

const DESIGN = `# 0009: Report colors

| | |
|---|---|
| **Status** | Proposed. Three questions in section 4 wait for the owner. |
| **Date** | 2026-11-16 |

## 1. What this design settles

How the report writer colors its tables.

## 4. Questions for the owner

### Q1. Which palette do reports use?

- **Recommend: the theme's palette** (section 2). Reports match the rest of the product.
- **Alternative: a fixed high-contrast palette.** Readable everywhere, at the cost of clashing with the theme.

### Q2. Are colors on by default?

The report writer prints to terminals that may not show color.

- **Recommend: on when the terminal says it can show them**, off otherwise.
- **Alternative: always off unless asked for.** Plain output everywhere.
- **Alternative: always on.** Simplest code, at the cost of escape codes in logs.

### Q3. Does the HTML report share the palette?

- **Recommend: yes, the same palette.** One set of colors to keep.
- **Alternative: no, its own palette.** Free to use the browser's colors.
`;

/** A repository with the policy, the tracker fixture (project W-2) and the design. */
function project() {
  const root = makeRepo({
    files: { '.human-in-the-lead/policy.json': `${POLICY}\n`, [FILE]: DESIGN },
  });
  return { root, env: isolatedEnv() };
}

/** @param {string} cwd @param {string[]} argv @param {NodeJS.ProcessEnv} env */
async function run(cwd, argv, env) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, ...JSON.parse(out) };
}

/** The question to record for one design question, with its labels shortened as shown. */
async function shown(
  /** @type {string} */ root,
  /** @type {NodeJS.ProcessEnv} */ env,
  /** @type {number} */ n,
  /** @type {string[]} */ labels,
) {
  const listed = await run(root, ['design', 'questions', '--file', FILE, '--parent', 'W-2'], env);
  const record = listed.questions[n].record;
  record.options = record.options.map((/** @type {any} */ o, /** @type {number} */ i) => ({
    label: labels[i] ?? o.label,
    what_happens: `${o.label}: ${o.what_happens}`,
  }));
  return JSON.stringify(record);
}

test("a design's questions are read with their options, recommendation and state", () => {
  const d = readDesign(DESIGN, FILE);
  assert.equal(d.design, '0009');
  assert.deepEqual(d.section, { heading: '4. Questions for the owner', number: '4' });
  assert.deepEqual(
    d.questions.map((q) => [q.id, q.state, q.options.length, q.recommendation]),
    [
      ['Q1', 'open', 2, 'A'],
      ['Q2', 'open', 3, 'A'],
      ['Q3', 'open', 2, 'A'],
    ],
  );
  assert.deepEqual(d.questions[0].options[1], {
    letter: 'B',
    kind: 'Alternative',
    label: 'a fixed high-contrast palette',
    what_happens: 'Readable everywhere, at the cost of clashing with the theme.',
  });
  assert.match(d.questions[1].context, /section 4\)\. The report writer prints to terminals/);
  assert.deepEqual(problemsOf(d), []);

  // A decided design, as the owner left one: every question decided, with its date.
  const decided = readDesign(
    readFileSync(join(ROOT, 'docs/design/0003-private-store-remote.md'), 'utf8'),
    'docs/design/0003-private-store-remote.md',
  );
  assert.equal(decided.questions.length, 8);
  assert.ok(
    decided.questions.every((q) => q.state === 'decided' && q.decided?.date === '2026-11-15'),
  );

  // An open question without a recommendation cannot be put as it stands.
  const bare = DESIGN.replace('- **Recommend: yes, the same palette.**', '- **Alternative: yes.**');
  assert.deepEqual(problemsOf(readDesign(bare, FILE)), ['Q3 has no option marked Recommend']);
  assert.deepEqual(problemsOf(readDesign('# 0010: Nothing\n', 'x.md')), [
    'no section heading names questions',
  ]);

  // The decided line goes under the heading, one blank line either side.
  const q1 = readDesign(DESIGN, FILE).questions[0];
  const text = writeDecided(DESIGN, q1, {
    date: '2026-11-16',
    answer: 'the theme',
    decision: 'W-9',
  });
  assert.match(
    text,
    /### Q1\. Which palette do reports use\?\n\n\*\*Decided by the owner \(2026-11-16\): the theme\.\*\* Recorded as W-9\.\n\n- \*\*Recommend/,
  );
});

test('each recorded choice is written under its question; a skipped one stays open and holds the design', async () => {
  const { root, env } = project();
  const listed = await run(root, ['design', 'questions', '--file', FILE, '--parent', 'W-2'], env);
  assert.equal(listed.code, 0, JSON.stringify(listed));
  assert.equal(listed.open, 3);
  assert.equal(listed.questions[0].record.title, 'Design 0009 Q1: Which palette do reports use?');
  assert.equal(listed.questions[0].record.parent, 'W-2');
  assert.equal(listed.questions[0].record.classification, 'public');

  // Q1 through the question tool, with short labels: the design gets its own words for option A.
  const q1 = await run(
    root,
    [
      'rights',
      'record',
      '--question',
      await shown(root, env, 0, ['Theme palette', 'High contrast']),
      '--answer',
      'A',
      '--via',
      'question-tool',
    ],
    env,
  );
  assert.equal(q1.code, 0, JSON.stringify(q1));
  const a1 = await run(
    root,
    ['design', 'answer', '--file', FILE, '--question', 'Q1', '--decision', q1.decision],
    env,
  );
  assert.equal(a1.code, 0, JSON.stringify(a1));
  assert.equal(a1.option, 'A');
  assert.deepEqual(a1.open, ['Q2', 'Q3']);

  // Q2 is skipped: nothing is recorded. Q3 in chat, in the owner's own words.
  const q3 = await run(
    root,
    [
      'rights',
      'record',
      '--question',
      await shown(root, env, 2, []),
      '--answer',
      "Neither; the HTML report follows the browser's dark mode",
      '--via',
      'chat',
    ],
    env,
  );
  assert.equal(q3.code, 0, JSON.stringify(q3));
  // Another question's decision does not answer Q2, and an open decision answers nothing.
  const wrong = await run(
    root,
    ['design', 'answer', '--file', FILE, '--question', 'Q2', '--decision', q3.decision],
    env,
  );
  assert.equal(wrong.error, 'decision-not-for-question');
  put(root, {
    'work/items/W-20-q2.md': itemText({
      id: 'W-20',
      title: '"Design 0009 Q2: Are colors on by default?"',
      kind: 'decision',
      state: 'planned',
      project: 'W-2',
      decider: 'owner',
    }),
  });
  const unanswered = await run(
    root,
    ['design', 'answer', '--file', FILE, '--question', 'Q2', '--decision', 'W-20'],
    env,
  );
  assert.equal(unanswered.error, 'not-answered', JSON.stringify(unanswered));
  const a3 = await run(
    root,
    ['design', 'answer', '--file', FILE, '--question', 'Q3', '--decision', q3.decision],
    env,
  );
  assert.equal(a3.code, 0, JSON.stringify(a3));
  assert.equal(a3.option, null);

  const early = await run(root, ['design', 'decide', '--file', FILE], env);
  assert.equal(early.error, 'questions-open');
  assert.deepEqual(early.open, ['Q2']);
  const held = readFileSync(join(root, FILE), 'utf8');
  assert.match(held, /\| \*\*Status\*\* \| Proposed\./);
  assert.doesNotMatch(held, /### Q2\. Are colors on by default\?\n\n\*\*Decided/);
  assert.match(
    held,
    new RegExp(
      `\\*\\*Decided by the owner \\(\\d{4}-\\d{2}-\\d{2}\\): the theme's palette\\.\\*\\* Recorded as ${q1.decision}\\.`,
    ),
  );
  assert.match(
    held,
    new RegExp(
      `\\*\\*Decided by the owner \\(\\d{4}-\\d{2}-\\d{2}\\): Neither; the HTML report follows the browser's dark mode\\.\\*\\* Recorded as ${q3.decision}\\.`,
    ),
  );

  // Q2, recorded with fewer options than the design has, cannot be named in the design's words.
  const two = JSON.parse(await shown(root, env, 1, ['When supported', 'Always off']));
  two.options = two.options.slice(0, 2);
  const q2short = await run(
    root,
    [
      'rights',
      'record',
      '--question',
      JSON.stringify(two),
      '--answer',
      'B',
      '--via',
      'question-tool',
    ],
    env,
  );
  assert.equal(q2short.code, 0, JSON.stringify(q2short));
  const differ = await run(
    root,
    ['design', 'answer', '--file', FILE, '--question', 'Q2', '--decision', q2short.decision],
    env,
  );
  assert.equal(differ.error, 'options-differ');

  // The owner answers Q2 later; then the design is decided, and a decided question is not rewritten.
  const q2 = await run(
    root,
    [
      'rights',
      'record',
      '--question',
      await shown(root, env, 1, ['When supported', 'Always off', 'Always on']),
      '--answer',
      'B',
      '--via',
      'question-tool',
    ],
    env,
  );
  const a2 = await run(
    root,
    ['design', 'answer', '--file', FILE, '--question', 'Q2', '--decision', q2.decision],
    env,
  );
  assert.equal(a2.code, 0, JSON.stringify(a2));
  const again = await run(
    root,
    ['design', 'answer', '--file', FILE, '--question', 'Q2', '--decision', q2.decision],
    env,
  );
  assert.equal(again.error, 'already-decided');
  const decided = await run(root, ['design', 'decide', '--file', FILE], env);
  assert.equal(decided.code, 0, JSON.stringify(decided));
  assert.deepEqual(decided.decisions, [
    { question: 'Q1', decision: q1.decision },
    { question: 'Q2', decision: q2.decision },
    { question: 'Q3', decision: q3.decision },
  ]);
  const text = readFileSync(join(root, FILE), 'utf8');
  assert.match(
    text,
    /\| \*\*Status\*\* \| Decided by the owner \(\d{4}-\d{2}-\d{2}\): every question in section 4 is answered\. \|/,
  );
  assert.match(text, /\): always off unless asked for\.\*\* Recorded as/);
});

test("an executor may read the questions but not write the owner's answers or decide a design", async () => {
  const { root, env } = project();
  const executor = { ...env, HITLD_ROLE: 'executor' };
  const listed = await run(root, ['design', 'questions', '--file', FILE], executor);
  assert.equal(listed.code, 0, JSON.stringify(listed));
  for (const argv of [
    ['design', 'answer', '--file', FILE, '--question', 'Q1', '--decision', 'W-6'],
    ['design', 'decide', '--file', FILE],
  ]) {
    const r = await run(root, argv, executor);
    assert.equal(r.error, 'not-permitted', JSON.stringify(r));
  }
  assert.equal(readFileSync(join(root, FILE), 'utf8'), DESIGN);

  const outside = await run(root, ['design', 'questions', '--file', '../elsewhere.md'], env);
  assert.equal(outside.error, 'usage');
});
