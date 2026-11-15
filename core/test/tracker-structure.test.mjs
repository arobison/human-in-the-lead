// HITLD-90: projects being shaped, initiatives retired into milestones, one milestone kind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { fromLegacy } from '../lib/tracker/files/legacy.mjs';
import { numberedName } from '../lib/tracker/files/milestones.mjs';
import { parseCostOfDelay, readProject } from '../lib/tracker/files/projects.mjs';
import { trackerStructure } from '../lib/tracker/files/migrations/tracker-structure.mjs';
import { git, isolatedEnv, itemText, makeRepo, policyFor } from './tracker-fixture.mjs';

/** No person file, private store or store address of this machine is read. */
const HOME = isolatedEnv();

const open = (/** @type {string} */ root) =>
  openTracker({ repoRoot: root, policy: policyFor(), env: { ...HOME } });

/** @param {Record<string, string>} files @param {string[]} [omit] */
const problems = (files, omit = []) => open(makeRepo({ files, omit })).check().problems;

/** A project W-2 with the given keys. @param {Record<string, string | string[]>} extra */
const project = (extra) =>
  itemText({ id: 'W-2', title: 'The project', kind: 'project', state: 'planned', ...extra });

const W2 = 'work/projects/W-2-the-project.md';

test('a project being shaped carries the shaping fields, typed by the read API', () => {
  const root = makeRepo({
    files: {
      [W2]: project({
        state: 'proposed',
        problem: 'Repeated requests are slow.',
        signals: ['SIG-1'],
        evidence: ['"run 41: median 900 ms"'],
        options: [
          '"do nothing: slow requests continue"',
          '"cache by key: fast, needs invalidation"',
        ],
        value: '8',
        confidence: '0.6',
        cost_of_delay: 'fixed-date rate=2 date=2027-03-01',
        appetite_tokens: '2000000',
        out_of_scope: ['a shared cache'],
        risks: ['invalidation'],
      }),
    },
  });
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  const e = t.get('W-2');
  assert.equal(e.problem, 'Repeated requests are slow.');
  assert.deepEqual(e.signals, ['SIG-1']);
  assert.deepEqual(e.options, [
    { label: 'do nothing', tradeoffs: 'slow requests continue' },
    { label: 'cache by key', tradeoffs: 'fast, needs invalidation' },
  ]);
  assert.equal(e.value, 8);
  assert.equal(e.confidence, 0.6);
  assert.deepEqual(e.cost_of_delay, { profile: 'fixed-date', rate: 2, date: '2027-03-01' });
  assert.equal(e.appetite_tokens, 2000000);
  assert.deepEqual(e.out_of_scope, ['a shared cache']);
  assert.equal(e.bet_by, null, 'no bet yet');
  assert.equal(e.owner, 'owner', 'a record without an owner key is the owner’s');
});

test('shaping fields that do not parse are named', () => {
  const found = problems({
    [W2]: project({
      options: ['no label here'],
      value: '0',
      confidence: '1.5',
      cost_of_delay: 'fixed-date',
      appetite_tokens: 'lots',
      signals: ['W-3'],
    }),
  });
  for (const p of [
    `${W2}: option "no label here" isn't "<label>: <trade-offs>"`,
    `${W2}: value "0" isn't a number above 0`,
    `${W2}: confidence "1.5" isn't a number from 0 to 1`,
    `${W2}: cost_of_delay "fixed-date": a fixed-date profile needs its date (date=YYYY-MM-DD)`,
    `${W2}: appetite_tokens "lots" isn't a whole number of tokens`,
    `${W2}: signals "W-3" isn't SIG-<n>`,
  ]) {
    assert.ok(found.includes(p), `missing: ${p}\n${found.join('\n')}`);
  }
  assert.deepEqual(parseCostOfDelay('standard'), { profile: 'standard' });
  assert.equal(readProject({ value: '3.5' }).value, 3.5);
});

test("the owner's bet moves a project to planned: its decision is answered, and bet_by comes from it", () => {
  const decision = (/** @type {Record<string, string>} */ extra) => ({
    'work/items/W-6-which-way.md': itemText({
      id: 'W-6',
      title: 'Bet on the project?',
      kind: 'decision',
      state: 'planned',
      project: 'W-2',
      decider: 'owner',
      ...extra,
    }),
  });
  // Planned on an open decision: not a bet yet.
  assert.ok(
    problems({ [W2]: project({ decision: 'W-6' }), ...decision({}) }).includes(
      `${W2}: decision W-6 isn't answered; a project is planned only by the owner's bet, the answer to its decision`,
    ),
  );
  // Proposed with its decision still open is a project being shaped: fine.
  assert.deepEqual(problems({ [W2]: project({ state: 'proposed', decision: 'W-6' }) }), []);
  const root = makeRepo({
    files: {
      [W2]: project({ decision: 'W-6' }),
      ...decision({
        state: 'done',
        answer: 'A',
        answered_at: '2026-11-15',
        answered_via: 'main-session',
        answered_by: 'owner',
      }),
    },
  });
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.equal(t.get('W-2').bet_by, 'owner');
  assert.equal(t.get('W-2').decision, 'W-6');
  // bet_by is derived: a file that stores it is told so.
  assert.ok(
    problems({ [W2]: project({ bet_by: 'owner' }) }).includes(
      `${W2}: "bet_by" is retired: it is derived from the project's decision; run hitld work migrate`,
    ),
  );
  // A rejected project is dropped, with its reason.
  assert.ok(
    problems({ [W2]: project({ state: 'dropped' }) }).includes(`${W2}: dropped needs a reason`),
  );
});

test("the project holds the appetite: its milestones' shares must fit it", () => {
  const ms = (/** @type {number} */ n, /** @type {string} */ tokens, state = 'planned') => ({
    [`work/milestones/W-${n}-m${n}.md`]: itemText({
      id: `W-${n}`,
      title: `Outcome ${'abc'[n - 7]}`,
      kind: 'milestone',
      state,
      project: 'W-2',
      appetite_tokens: tokens,
      ...(state === 'dropped' ? { reason: 'cut' } : {}),
    }),
  });
  const within = { [W2]: project({ appetite_tokens: '1000' }), ...ms(7, '600'), ...ms(8, '400') };
  assert.deepEqual(problems(within), []);
  assert.ok(
    problems({ ...within, ...ms(9, '1', 'planned') }).includes(
      `${W2}: its milestones' shares of the appetite (1001 tokens: W-7 600, W-8 400, W-9 1) exceed its appetite_tokens 1000`,
    ),
  );
  assert.deepEqual(
    problems({ ...within, ...ms(9, '500', 'dropped') }),
    [],
    'a dropped share is free',
  );
  assert.ok(
    problems({ ...ms(7, '600') }).includes(
      `${W2}: its milestones hold shares of an appetite (W-7 600) it doesn't set; give it appetite_tokens`,
    ),
  );
  const t = open(makeRepo({ files: within }));
  assert.match(
    t.renderViewTexts().projects,
    /appetite: 1000 tokens, 1000 shared out to its milestones/,
  );
});

test('a milestone is named by its outcome: the check refuses M1, v2, phase 3', () => {
  for (const [title, part] of [
    ['M1', 'M1'],
    ['Ship v2', 'v2'],
    ['Phase 3: the rest', 'Phase 3'],
    ['1. Setup', '1.'],
  ]) {
    assert.equal(numberedName(title), part, title);
    const found = problems({
      'work/milestones/W-7-x.md': itemText({
        id: 'W-7',
        title: `"${title}"`,
        kind: 'milestone',
        state: 'planned',
        project: 'W-2',
      }),
    });
    assert.ok(
      found.includes(
        `work/milestones/W-7-x.md: the name numbers the milestone ("${part}"); name it by its outcome, and let the graph give the order`,
      ),
      found.join('\n'),
    );
  }
  for (const title of [
    'Config errors explained',
    'First release',
    'Runs on Node 24',
    'IPv6 works',
  ]) {
    assert.equal(numberedName(title), null, title);
  }
});

test('a learning milestone is the one whose check is a study: derived, not stored', () => {
  const root = makeRepo({
    files: {
      'work/milestones/W-7-which-key.md': itemText({
        id: 'W-7',
        title: 'We know which key',
        kind: 'milestone',
        state: 'planned',
        project: 'W-2',
        check: 'study FB-3',
      }),
    },
  });
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.equal(t.get('W-7').kind, 'milestone');
  assert.match(
    t.renderViewTexts().milestones,
    /W-7 We know which key \[Planned\], learning, under W-2 The project/,
  );
});

test('a long outcome is a milestone with no parent whose constraints are other milestones', () => {
  const root = makeRepo({
    files: {
      'work/milestones/W-1-goal.md': itemText({
        id: 'W-1',
        title: 'The goal',
        kind: 'milestone',
        state: 'planned',
        constraints: ['W-7 c?'],
      }),
      'work/milestones/W-7-part.md': itemText({
        id: 'W-7',
        title: 'A part of it',
        kind: 'milestone',
        state: 'planned',
        project: 'W-2',
        constraints: ['W-4 c?'],
      }),
    },
  });
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.equal(t.get('W-1').parent, undefined);
  assert.deepEqual(t.get('W-7').constraint_of, undefined, 'only items carry constraint_of');
  assert.deepEqual(t.get('W-4').constraint_of, ['W-7']);
  assert.match(t.renderViewTexts().milestones, /^W-1 The goal \[Planned\], a long outcome\n/);
  assert.throws(() => t.link('W-2', 'parent', 'W-1'), /a project, which has no parent/);
});

test('the old kinds are named in the working tree, with the migration that moves them', () => {
  const found = problems(
    {
      'work/initiatives/W-1-goal.md': itemText({
        id: 'W-1',
        title: 'The goal',
        kind: 'initiative',
        state: 'planned',
      }),
      'work/milestones/W-7-a.md': itemText({
        id: 'W-7',
        title: 'A',
        kind: 'learning',
        state: 'planned',
        project: 'W-2',
      }),
      'work/projects/W-8-o.md': itemText({
        id: 'W-8',
        title: 'O',
        kind: 'opportunity',
        state: 'shaping',
      }),
    },
    ['work/milestones/W-1-goal.md'],
  );
  for (const p of [
    'work/initiatives/W-1-goal.md: kind "initiative" is now "milestone" (a long outcome is a milestone with no parent, whose constraints are other milestones); run hitld work migrate',
    'work/milestones/W-7-a.md: kind "learning" is now "milestone" (there is one milestone kind; a learning milestone is one whose check is a study); run hitld work migrate',
    'work/projects/W-8-o.md: kind "opportunity" is now "project" (a project being shaped is a proposed project); run hitld work migrate',
    'work/initiatives/W-1-goal.md: needs migration "tracker-structure" (run hitld work migrate)',
  ]) {
    assert.ok(found.includes(p), `missing: ${p}\n${found.join('\n')}`);
  }
});

test('the old kinds are read from git in the new form', () => {
  assert.deepEqual(
    fromLegacy({ id: 'W-1', kind: 'initiative', status: 'Planned', lead: 'owner' }),
    { id: 'W-1', kind: 'milestone', state: 'planned', owner: 'owner' },
  );
  assert.deepEqual(
    fromLegacy({
      id: 'W-7',
      kind: 'learning',
      state: 'done',
      initiative: 'W-1',
      needs: ['W-3 c1'],
    }),
    { id: 'W-7', kind: 'milestone', state: 'done', constraints: ['W-3 c1'] },
  );
  assert.deepEqual(
    fromLegacy({ id: 'W-2', kind: 'project', state: 'planned', initiative: 'W-1' }),
    {
      id: 'W-2',
      kind: 'project',
      state: 'planned',
    },
  );
  assert.deepEqual(
    fromLegacy({
      id: 'W-9',
      kind: 'opportunity',
      state: 'bet',
      no_gos: ['x'],
      rabbit_holes: ['y'],
      bet_decision: 'W-6',
      bet_by: 'owner',
    }),
    {
      id: 'W-9',
      kind: 'project',
      state: 'planned',
      out_of_scope: ['x'],
      risks: ['y'],
      decision: 'W-6',
    },
  );
  const current = { id: 'W-4', kind: 'work', state: 'planned', project: 'W-2' };
  assert.deepEqual(fromLegacy(current), current);
});

test('migrate tracker-structure: initiatives, milestone kinds, project parents and opportunities, in one reviewable commit', async () => {
  const root = makeRepo({
    omit: ['work/milestones/W-1-goal.md'],
    files: {
      'work/initiatives/W-1-goal.md':
        '---\nid: W-1\ntitle: The goal\nkind: initiative\nstate: done\ncreated: 2026-11-01\nowner: owner\n---\n\n## Goal\n\nIt all works.\n',
      [W2]: '---\nid: W-2\ntitle: "The project"\nkind: project\nstate: planned\ninitiative: W-1\nowner: owner\n---\n\nKept as it is.\n',
      'work/milestones/W-7-alpha.md':
        '---\nid: W-7\ntitle: Alpha\nkind: capability\nstate: planned\nproject: W-2\nconstraints: [W-4 c?]\n---\n\n## Notes\n\nAlpha notes.\n',
      'work/milestones/W-8-which-key.md':
        '---\nid: W-8\ntitle: Which key\nkind: learning\nstate: planned\ninitiative: W-1\ncheck: study FB-3\n---\n',
      'work/milestones/W-9-unsure.md':
        '---\nid: W-9\ntitle: Unsure\nkind: learning\nstate: planned\nproject: W-2\n---\n\nA question.\n',
      'work/milestones/W-10-gone.md':
        '---\nid: W-10\ntitle: Gone\nkind: capability\nstate: dropped\nproject: W-2\nreason: cut\n---\n',
      'work/projects/W-11-faster-start.md':
        '---\nid: W-11\ntitle: Faster start\nkind: opportunity\nstate: rejected\nproblem: Start is slow.\nno_gos: [rewrite]\nbet_by: owner\n---\n\nShaped once.\n',
    },
  });
  const t = open(root);
  const dry = t.migrate({ dryRun: true, only: 'tracker-structure' });
  assert.equal(dry.commit, null);
  assert.deepEqual(
    dry.migrations[0].files.map((f) => `${f.action} ${f.path}`),
    [
      'change work/milestones/W-10-gone.md',
      'change work/milestones/W-7-alpha.md',
      'change work/milestones/W-8-which-key.md',
      'change work/milestones/W-9-unsure.md',
      `change ${W2}`,
      'change work/projects/W-11-faster-start.md',
      'delete work/initiatives/W-1-goal.md',
      'create work/milestones/W-1-goal.md',
    ],
  );
  assert.equal(
    dry.migrations[0].files.find((f) => f.path === W2)?.diff,
    ' state: planned\n-initiative: W-1\n owner: owner',
    'only its own lines change',
  );
  const done = t.migrate({ only: 'tracker-structure' });
  assert.match(git(root, 'log', '-1', '--format=%s').trim(), /^migrate: tracker-structure$/);
  assert.equal(done.changed, 8);
  assert.equal(git(root, 'status', '--porcelain'), '');

  const read = (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8');
  assert.equal(existsSync(join(root, 'work/initiatives/W-1-goal.md')), false);
  const goal = read('work/milestones/W-1-goal.md');
  assert.match(
    goal,
    /^---\nid: W-1\ntitle: The goal\nkind: milestone\nstate: planned\ncreated: 2026-11-01\nowner: owner\nconstraints: \[W-7 c\?, W-8 c\?, W-9 c\?\]\n---\n\n## Goal\n\nIt all works\.\n\n## Notes\n\nMade by/,
  );
  assert.match(goal, /The initiative was done\. A milestone is done only by a passing check\.\n$/);
  assert.equal(
    read('work/milestones/W-7-alpha.md'),
    '---\nid: W-7\ntitle: Alpha\nkind: milestone\nstate: planned\nproject: W-2\nconstraints: [W-4 c?]\n---\n\n## Notes\n\nAlpha notes.\n',
  );
  assert.equal(
    read('work/milestones/W-8-which-key.md'),
    '---\nid: W-8\ntitle: Which key\nkind: milestone\nstate: planned\ncheck: study FB-3\n---\n',
    'a study check makes it a learning milestone: no note',
  );
  assert.match(
    read('work/milestones/W-9-unsure.md'),
    /^---\nid: W-9\ntitle: Unsure\nkind: milestone\n[\s\S]*A question\.\n\n## Notes\n\nThis was a learning milestone\./,
  );
  assert.equal(
    read(W2),
    '---\nid: W-2\ntitle: "The project"\nkind: project\nstate: planned\nowner: owner\n---\n\nKept as it is.\n',
  );
  assert.match(
    read('work/projects/W-11-faster-start.md'),
    /^---\nid: W-11\ntitle: Faster start\nkind: project\nstate: dropped\nproblem: Start is slow\.\nout_of_scope: \[rewrite\]\nreason: rejected as an opportunity\n---\n\nShaped once\.\n$/,
  );
  assert.deepEqual(open(root).check().problems, []);
  const head = git(root, 'rev-parse', 'HEAD');
  assert.equal(open(root).migrate().changed, 0, 'a second run changes nothing');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(trackerStructure.name, 'tracker-structure');
});
