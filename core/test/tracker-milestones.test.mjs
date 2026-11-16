// Milestones as entities (design part 3.2): the format, the check, the derived fields, the read
// API, the views and the migration from the `milestone` and `milestones` keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import {
  milestoneDerived,
  parseCheckResult,
  parseConstraint,
  parseContribution,
  readMilestone,
  storedMilestoneField,
  tokensByItem,
} from '../lib/tracker/files/milestones.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { buildReport, renderHtml, tokensPerItem } from '../lib/quota/report.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import {
  commitAll,
  git,
  isolatedEnv,
  itemText,
  makeRepo,
  policyFor,
  put,
} from './tracker-fixture.mjs';

/** No person file, private store or store address of this machine is read. */
const HOME = isolatedEnv();

const open = (/** @type {string} */ root) =>
  openTracker({ repoRoot: root, policy: policyFor(), env: { ...HOME } });

/** A milestone W-7 under W-2. @param {Record<string, string | string[]>} [extra] */
const milestone = (extra = {}) =>
  itemText({
    id: 'W-7',
    title: 'Config errors explained',
    kind: 'milestone',
    state: 'planned',
    project: 'W-2',
    outcome: 'A user with a bad config sees which key is wrong.',
    done_when: ['"c1: An unknown key exits with status 2."', '"c2: The message names the line."'],
    constraints: ['W-4 c1', 'W-5 c2'],
    ...extra,
  });

/** @param {Record<string, string>} files */
const problems = (files) => open(makeRepo({ files })).check().problems;

/** @param {string[]} argv @param {string} cwd */
async function hitld(argv, cwd) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: { ...HOME } });
  return { code, json: JSON.parse(out) };
}

/** Settings files, so the command line can open the tracker. @param {string} root */
function settings(root) {
  put(root, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
    }),
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'settings');
}

test('entries parse from one line each, and bad ones are named', () => {
  assert.deepEqual(parseConstraint('W-4 c1'), { id: 'W-4', clause: 'c1' });
  assert.deepEqual(parseConstraint('W-4 c?'), { id: 'W-4', clause: null });
  assert.match(/** @type {any} */ (parseConstraint('W-4')).error, /isn't "<ID> c<n>"/);
  assert.deepEqual(parseContribution('W-9 value=5 confidence=0.6'), {
    id: 'W-9',
    value: 5,
    confidence: 0.6,
  });
  assert.deepEqual(parseContribution('W-9 value=4 confidence=0.6'), {
    id: 'W-9',
    value: 4,
    confidence: 0.6,
  });
  assert.deepEqual(parseContribution('W-9 value=2.5 confidence=1'), {
    id: 'W-9',
    value: 2.5,
    confidence: 1,
  });
  for (const bad of ['0', '-3', 'lots', '1e3', '0.0']) {
    assert.match(
      /** @type {any} */ (parseContribution(`W-9 value=${bad} confidence=0.6`)).error,
      /isn't a number above 0/,
      bad,
    );
  }
  assert.match(
    /** @type {any} */ (parseContribution('W-9 value=3 confidence=1.5')).error,
    /confidence 1.5 isn't a number from 0 to 1/,
  );
  assert.deepEqual(parseCheckResult('pass 2026-12-01 acceptance-author: run 41 at 3f9c2a1'), {
    result: 'pass',
    date: '2026-12-01',
    role: 'acceptance-author',
    evidence: 'run 41 at 3f9c2a1',
  });
  const m = readMilestone({
    done_when: ['c1: one', 'c1: again'],
    constraints: ['W-4 c3'],
    contributions: ['W-4 value=3 confidence=0.5'],
    deadline: '2027-01-01',
  });
  assert.deepEqual(m.problems, [
    'deadline "2027-01-01" isn\'t "<YYYY-MM-DD> <source>": an external date needs its source',
    'done_when: clause c1 appears twice',
    "constraints W-4 names clause c3, which done_when doesn't have",
    'W-4 is both a constraint and a contribution; it is one or the other',
  ]);
  assert.deepEqual(storedMilestoneField('constraints', [{ id: 'W-4', clause: null }]), ['W-4 c?']);
  assert.deepEqual(
    tokensByItem([{ item: 'W-4', tokens: 10 }, { item: 'W-4', tokens: 5 }, {}]).get('W-4'),
    15,
  );
});

test('a milestone file passes the check, and its entity validates against the milestone schema', () => {
  const root = makeRepo({
    files: {
      'work/milestones/W-7-config-errors-explained.md': milestone({
        contributions: ['W-6 value=3 confidence=0.5'],
        appetite_tokens: '400000',
        deadline: '2027-03-01 the conference demo',
        check: 'integration-test test/config/errors.test.ts',
      }),
      // The project holds the appetite; the milestone's is a share of it.
      'work/projects/W-2-the-project.md': itemText({
        id: 'W-2',
        title: 'The project',
        kind: 'project',
        state: 'planned',
        appetite_tokens: '1000000',
      }),
    },
  });
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  const e = t.get('W-7');
  assert.equal(e.parent, 'W-2');
  assert.deepEqual(e.constraints, [
    { id: 'W-4', clause: 'c1' },
    { id: 'W-5', clause: 'c2' },
  ]);
  assert.deepEqual(e.check, { kind: 'integration-test', target: 'test/config/errors.test.ts' });
  assert.equal(e.appetite_tokens, 400000);
  const stored = [
    'body',
    'path',
    'version',
    'entity',
    'unmet_clauses',
    'check_due',
    'scope',
    'tokens_spent',
    'cost_of_delay_rate',
    'to_shape',
  ];
  const canonical = Object.fromEntries(Object.entries(e).filter(([k]) => !stored.includes(k)));
  assert.deepEqual(schemas().validateTrackerEntity({ schema_version: 1, ...canonical }), []);
  for (const derived of [
    'unmet_clauses',
    'check_due',
    'scope',
    'tokens_spent',
    'cost_of_delay_rate',
  ]) {
    const errors = schemas().validateEntity('milestone', {
      schema_version: 1,
      ...canonical,
      [derived]: 1,
    });
    assert.match(errors[0].message, /not a known key/, derived);
  }
  assert.deepEqual(t.get('W-4').constraint_of, ['W-7']);
  assert.deepEqual(t.get('W-6').contributes_to, ['W-7']);
  assert.deepEqual(t.get('W-3').constraint_of, []);
  assert.equal(
    /^(unmet_clauses|check_due|scope|to_shape):/m.test(
      readFileSync(join(root, 'work/milestones/W-7-config-errors-explained.md'), 'utf8'),
    ),
    false,
    'derived fields are never written',
  );
});

test('the check: clauses exist, contributions are scored, references resolve, no cycle runs through a milestone', () => {
  const found = problems({
    'work/milestones/W-7-config-errors-explained.md': milestone({
      constraints: ['W-4 c9', 'W-99 c1', 'W-1 c2'],
      contributions: ['W-6 value=0 confidence=0.5', 'W-2 value=3 confidence=0.5'],
      state: 'in-progress',
    }),
    'work/milestones/W-8-other.md': itemText({
      id: 'W-8',
      title: 'Other',
      kind: 'milestone',
      state: 'planned',
      project: 'W-2',
      initiative: 'W-1',
      constraints: ['W-9 c?'],
    }),
    'work/items/W-9-loop.md': itemText({
      id: 'W-9',
      title: 'Loop',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      needs: ['W-8'],
    }),
  });
  for (const p of [
    'work/milestones/W-7-config-errors-explained.md: a milestone is never in-progress: only work items are claimed',
    "work/milestones/W-7-config-errors-explained.md: constraints W-4 names clause c9, which done_when doesn't have",
    "work/milestones/W-7-config-errors-explained.md: contributions: W-6: value 0 isn't a number above 0",
    'work/milestones/W-8-other.md: "initiative" is retired: initiatives are milestones now: a long outcome is a milestone with no parent (design part 3.2); run hitld work migrate',
  ]) {
    assert.ok(found.includes(p), `missing: ${p}\n${found.join('\n')}`);
  }
  const refs = problems({
    'work/milestones/W-7-config-errors-explained.md': milestone({
      constraints: ['W-99 c1', 'W-2 c2'],
      contributions: ['W-2 value=3 confidence=0.5'],
    }),
    'work/milestones/W-8-other.md': itemText({
      id: 'W-8',
      title: 'Other',
      kind: 'milestone',
      state: 'planned',
      project: 'W-2',
      constraints: ['W-9 c?'],
    }),
    'work/items/W-9-loop.md': itemText({
      id: 'W-9',
      title: 'Loop',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      needs: ['W-8'],
    }),
  });
  for (const p of [
    "work/milestones/W-7-config-errors-explained.md: needs W-99, which doesn't exist",
    'work/milestones/W-7-config-errors-explained.md: needs W-2, a project; needs name items and milestones only',
    'work/milestones/W-7-config-errors-explained.md: contributions W-2, a project; contributions are items',
    'cycle: W-9 → W-8 → W-9',
  ]) {
    assert.ok(refs.includes(p), `missing: ${p}\n${refs.join('\n')}`);
  }
});

test('Done only from a recorded passing check by a role other than the items’ authors', () => {
  // A learning milestone is one whose check is a study.
  const files = (/** @type {string[]} */ results, status = 'done', learning = false) => ({
    'work/milestones/W-7-config-errors-explained.md': milestone({
      ...(learning ? { check: 'study FB-3' } : {}),
      state: status,
      constraints: ['W-3 c1'],
      done_when: ['"c1: It works."'],
      ...(results.length ? { check_results: results.map((r) => `"${r}"`) } : {}),
    }),
  });
  const say = (/** @type {string[]} */ ps) =>
    ps.filter((p) => p.includes('W-7') && p.includes('done needs'));
  assert.equal(say(problems(files([]))).length, 1);
  assert.equal(say(problems(files(['pass 2026-12-01 executor: ran it myself']))).length, 1);
  assert.equal(
    say(
      problems(
        files(['pass 2026-12-01 acceptance-author: run 41', 'fail 2026-12-02 owner: broke']),
      ),
    ).length,
    1,
    'the latest run counts',
  );
  assert.deepEqual(say(problems(files(['pass 2026-12-01 acceptance-author: run 41']))), []);
  assert.deepEqual(
    say(problems(files(['answered 2026-12-01 researcher: study FB-3 says no'], 'done', true))),
    [],
    'a learning milestone is Done when its study has a verdict, whatever it says',
  );
  assert.equal(say(problems(files(['pass 2026-12-01 researcher: x'], 'done', true))).length, 1);

  // A role named in the items' commits is an author too.
  const root = makeRepo({ files: files(['pass 2026-12-01 reviewer: looked'], 'planned') });
  put(root, { 'note.txt': 'x\n' });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'work', '-m', 'Work-Item: W-3\nAgent-Role: reviewer');
  const t = open(root);
  assert.throws(
    () => t.transition('W-7', 'done', '', {}),
    /done only from a recorded passing check by a role other than its items' authors \(executor, reviewer\)/,
  );
  assert.throws(() => t.transition('W-7', 'in-progress', '', {}), /only work items are claimed/);
});

test('derived: unmet_clauses, check_due, scope, to_shape and tokens_spent are computed, never stored', () => {
  /** @type {Record<string, Record<string, unknown>>} */
  const byId = {
    'W-4': { state: 'done', estimate_tokens: '100' },
    'W-5': { state: 'planned', estimate_tokens: '200' },
    'W-6': { state: 'planned', estimate_tokens: '300' },
    'W-8': { state: 'planned', estimate_tokens: '50' },
    'W-9': { state: 'planned' },
  };
  const d = {
    id: 'W-7',
    kind: 'capability',
    state: 'planned',
    done_when: ['c1: one', 'c2: two'],
    constraints: ['W-4 c1', 'W-5 c2', 'W-10 c?'],
    contributions: [
      'W-6 value=8 confidence=0.5',
      'W-8 value=3 confidence=1',
      'W-9 value=1 confidence=1',
    ],
    appetite_tokens: '400',
  };
  const ctx = {
    get: (/** @type {string} */ id) => byId[id],
    authorRoles: new Set(['executor']),
    tokens: new Map([
      ['W-4', 1000],
      ['W-8', 7],
    ]),
  };
  const x = milestoneDerived(d, ctx);
  assert.deepEqual(x.unmet_clauses, [
    { clause: 'c1', text: 'one', open: [], checked: false },
    { clause: 'c2', text: 'two', open: ['W-5'], checked: false },
    { clause: null, text: null, open: ['W-10'], checked: false },
  ]);
  assert.equal(x.check_due, false);
  // 400 - 300 (constraints) = 100 left: W-8 (3 per 50) fits, W-6 (4 per 300) does not.
  assert.deepEqual(x.scope, {
    appetite_tokens: 400,
    constraint_tokens: 300,
    fits: ['W-8'],
    cut: ['W-6'],
    unsized: ['W-9'],
    too_big: false,
  });
  assert.equal(x.tokens_spent, 1007);
  assert.equal(x.cost_of_delay_rate, null);
  assert.deepEqual(x.to_shape, ['outcome', 'check', 'link W-10 to a clause']);
  byId['W-5'].state = 'done';
  byId['W-10'] = { state: 'done' };
  const due = milestoneDerived(d, ctx);
  assert.equal(due.check_due, true);
  const passed = milestoneDerived(
    { ...d, check_results: ['pass 2026-12-01 owner: demo ran'] },
    ctx,
  );
  assert.equal(passed.check_due, false);
  assert.deepEqual(passed.unmet_clauses, []);
  assert.equal(milestoneDerived({ ...d, appetite_tokens: '100' }, ctx).scope.too_big, true);
});

test('the read API returns milestones with api_version and entity, and work new makes one proposed', async () => {
  const root = makeRepo({
    files: { 'work/milestones/W-7-config-errors-explained.md': milestone() },
  });
  settings(root);
  const show = await hitld(['work', 'show', 'W-7', '--json'], root);
  assert.equal(show.code, 0);
  assert.equal(show.json.api_version, 3);
  assert.equal(show.json.entity.kind, 'milestone');
  assert.equal(show.json.entity.entity, 'milestone');
  assert.equal(show.json.entity.check_due, false);
  assert.deepEqual(
    show.json.entity.unmet_clauses.map((/** @type {any} */ e) => e.clause),
    ['c1', 'c2'],
  );
  const query = await hitld(['work', 'query', '--kind', 'milestone', '--json'], root);
  assert.deepEqual(
    query.json.entities.map((/** @type {any} */ e) => e.id),
    ['W-1', 'W-7'],
  );
  const made = await hitld(
    [
      'work',
      'new',
      '--kind',
      'milestone',
      '--title',
      'Which cache key',
      '--parent',
      'W-2',
      '--outcome',
      'We know which key to use.',
    ],
    root,
  );
  assert.equal(made.code, 0, JSON.stringify(made.json));
  const text = readFileSync(join(root, made.json.path), 'utf8');
  assert.match(
    text,
    /^---\nid: W-8\ntitle: Which cache key\nkind: milestone\nstate: proposed\ncreated: [\d-]+\nproject: W-2\noutcome: We know which key to use\.\n---/,
  );
  const old = await hitld(
    ['work', 'new', '--kind', 'learning', '--title', 'x', '--parent', 'W-2'],
    root,
  );
  assert.equal(old.code, 1);
  assert.equal(made.json.path, 'work/milestones/W-8-which-cache-key.md');
  assert.deepEqual(open(root).check().problems, []);
});

test('views: milestones with their unmet clauses and scope, and the merged-but-unreleased stock', () => {
  const root = makeRepo({
    files: {
      'work/milestones/W-7-config-errors-explained.md': milestone({
        constraints: ['W-3 c1', 'W-4 c?'],
        contributions: ['W-5 value=3 confidence=0.5'],
        appetite_tokens: '1000',
      }),
    },
  });
  const texts = open(root).renderViewTexts();
  assert.equal(
    texts.milestones,
    [
      'W-1 The goal [Planned], a long outcome',
      '  constraints: 0 of 0 done',
      '  check due: every constraint is done; the check has not passed',
      '  to shape: outcome; done_when; check',
      '',
      'W-7 Config errors explained [Planned], under W-2 The project',
      '  outcome: A user with a bad config sees which key is wrong.',
      '  constraints: 1 of 2 done',
      '  unmet: c1 An unknown key exits with status 2. (check not passed)',
      '  unmet: c2 The message names the line. (check not passed)',
      '  unmet: not linked to a clause yet (open: W-4; check not passed)',
      '  scope: appetite 1000; constraints 0 tokens; in scope: none; not sized: W-5',
      '  to shape: check; link W-4 to a clause',
      '',
      '2 open milestone(s)',
      '',
    ].join('\n'),
  );
  assert.equal(
    texts.unreleased,
    'W-2 The project\n  W-3  First step\n\n1 merged item(s) not in a release\n',
  );
});

test('migrate: project milestones and item milestone keys become milestone files, in one commit, idempotent', async () => {
  const root = makeRepo({
    omit: ['work/milestones/W-1-goal.md'],
    files: {
      'work/initiatives/W-1-goal.md':
        '---\nid: W-1\ntitle: The goal\nkind: initiative\nstatus: Planned\nlead: owner\n---\n\n## Goal\n\nIt all works.\n',
      'work/projects/W-2-the-project.md':
        '---\nid: W-2\ntitle: "The project"\nkind: project\nstatus: Planned\ncreated: 2026-11-01\ninitiative: W-1\nlead: owner\nmilestones: [alpha, beta-two]\n---\n\n## Milestones\n\n- **alpha** (capability). Outcome: it starts.\n',
      'work/items/W-4-second-step.md': itemText({
        id: 'W-4',
        title: 'Second step',
        kind: 'work',
        status: 'Planned',
        priority: 'high',
        project: 'W-2',
        milestone: 'alpha',
        needs: ['W-3'],
      }),
      'work/items/W-5-third-step.md': itemText({
        id: 'W-5',
        title: 'Third step',
        kind: 'work',
        status: 'Planned',
        project: 'W-2',
        milestone: 'alpha',
        needs: ['W-4', 'W-6'],
      }),
    },
  });
  settings(root);
  const before = open(root).check().problems;
  assert.ok(before.some((p) => p.includes('needs migration "milestone-entities"')));
  assert.ok(before.some((p) => p.includes('"milestone" is retired')));
  const dry = await hitld(['work', 'migrate', '--dry-run'], root);
  assert.equal(dry.code, 0, JSON.stringify(dry.json));
  assert.equal(git(root, 'status', '--porcelain'), '');
  const done = await hitld(['work', 'migrate'], root);
  assert.equal(done.code, 0, JSON.stringify(done.json));
  assert.match(
    git(root, 'log', '-1', '--format=%s').trim(),
    /^migrate: milestone-entities, retire-priority, names-and-states, tracker-structure$/,
  );
  assert.equal(git(root, 'status', '--porcelain'), '');
  const alpha = readFileSync(join(root, 'work/milestones/W-7-alpha.md'), 'utf8');
  assert.match(
    alpha,
    /^---\nid: W-7\ntitle: Alpha\nkind: milestone\nstate: planned\ncreated: 2026-11-01\nproject: W-2\nconstraints: \[W-4 c\?, W-5 c\?\]\n---\n/,
  );
  assert.match(alpha, /From W-2:\n\n- \*\*alpha\*\* \(capability\)\. Outcome: it starts\./);
  assert.ok(existsSync(join(root, 'work/milestones/W-8-beta-two.md')));
  const project = readFileSync(join(root, 'work/projects/W-2-the-project.md'), 'utf8');
  assert.equal(project.includes('milestones:'), false);
  assert.equal(project.includes('initiative:'), false);
  // The initiative is a long outcome: a milestone with no parent, its projects' milestones its
  // constraints.
  assert.equal(existsSync(join(root, 'work/initiatives/W-1-goal.md')), false);
  assert.match(
    readFileSync(join(root, 'work/milestones/W-1-goal.md'), 'utf8'),
    /^---\nid: W-1\ntitle: The goal\nkind: milestone\nstate: planned\nowner: owner\nconstraints: \[W-7 c\?, W-8 c\?\]\n---\n\n## Goal\n\nIt all works\.\n\n## Notes\n\nMade by `hitld work migrate` \(tracker-structure\) from the initiative W-1/,
  );
  assert.ok(project.includes('title: "The project"'), 'other lines are left as they were');
  assert.ok(project.includes('\nstate: planned\n') && project.includes('\nowner: owner\n'));
  const item = readFileSync(join(root, 'work/items/W-4-second-step.md'), 'utf8');
  assert.equal(item.includes('milestone:'), false);
  assert.equal(item.includes('priority:'), false);
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.deepEqual(t.get('W-7').to_shape, [
    'outcome',
    'done_when',
    'check',
    'link W-4, W-5 to a clause',
  ]);
  const head = git(root, 'rev-parse', 'HEAD');
  const again = await hitld(['work', 'migrate'], root);
  assert.equal(again.json.changed, 0);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
});

test('migrate: numbers skip what another branch already holds', () => {
  const root = makeRepo({
    files: {
      'work/items/W-4-second-step.md': itemText({
        id: 'W-4',
        title: 'Second step',
        kind: 'work',
        state: 'planned',
        project: 'W-2',
        milestone: 'alpha',
      }),
    },
  });
  git(root, 'checkout', '-q', '-b', 'elsewhere');
  put(root, {
    'work/items/W-7-taken.md': itemText({
      id: 'W-7',
      title: 'Taken',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
  });
  commitAll(root, 'W-7 on another branch');
  git(root, 'checkout', '-q', 'main');
  const done = open(root).migrate({ dryRun: true });
  const created = done.migrations[0].files.filter((f) => f.action === 'create').map((f) => f.path);
  assert.deepEqual(created, ['work/milestones/W-8-alpha.md']);
});

test('scope ranks contributions by value times confidence per estimate token, for any positive value', () => {
  /** @type {Record<string, Record<string, unknown>>} */
  const byId = {
    'W-4': { state: 'planned', estimate_tokens: '100' },
    'W-5': { state: 'planned', estimate_tokens: '100' },
    'W-6': { state: 'planned', estimate_tokens: '100' },
  };
  const d = {
    id: 'W-7',
    kind: 'capability',
    state: 'planned',
    contributions: [
      'W-4 value=4 confidence=1',
      'W-5 value=0.5 confidence=1',
      'W-6 value=40 confidence=0.2',
    ],
    appetite_tokens: '200',
  };
  const x = milestoneDerived(d, { get: (id) => byId[id], authorRoles: new Set() });
  // per token: W-6 0.08, W-4 0.04, W-5 0.005; the appetite holds two.
  assert.deepEqual(x.scope.fits, ['W-6', 'W-4']);
  assert.deepEqual(x.scope.cut, ['W-5']);
});

// --- The milestone graph (design part 12.1.2) -----------------------------------------------

/**
 * Three milestones and one `needs` between them: W-1, a long outcome, needs W-7; W-7 has two open
 * constraints (W-4 with an estimate, W-5 without) and a contribution; W-8 is Done with a passed
 * check.
 */
const graphRepo = () =>
  makeRepo({
    files: {
      '.human-in-the-lead/tracker.json': JSON.stringify({
        schema_version: 1,
        optional_keys: ['estimate_tokens'],
      }),
      'work/projects/W-2-the-project.md': itemText({
        id: 'W-2',
        title: 'The project',
        kind: 'project',
        state: 'planned',
        owner: 'owner',
        appetite_tokens: '5000',
      }),
      'work/milestones/W-1-goal.md': itemText({
        id: 'W-1',
        title: 'The goal',
        kind: 'milestone',
        state: 'planned',
        owner: 'owner',
        outcome: 'Users trust their config. Second sentence.',
        constraints: ['W-7 c?'],
      }),
      'work/items/W-4-second-step.md': itemText({
        id: 'W-4',
        title: 'Second step',
        kind: 'work',
        state: 'planned',
        project: 'W-2',
        needs: ['W-3'],
        estimate_tokens: '300',
      }),
      'work/items/W-9-nice-to-have.md': itemText({
        id: 'W-9',
        title: 'Nice to have',
        kind: 'work',
        state: 'planned',
        project: 'W-2',
      }),
      'work/milestones/W-7-config-errors-explained.md': milestone({
        appetite_tokens: '1000',
        contributions: ['W-9 value=3 confidence=0.5'],
      }),
      'work/milestones/W-8-first-step-shown.md': itemText({
        id: 'W-8',
        title: 'First step shown',
        kind: 'milestone',
        state: 'done',
        project: 'W-2',
        outcome: 'The first step is shown.',
        done_when: ['"c1: It is shown."'],
        constraints: ['W-3 c1'],
        check: 'demo the first step',
        check_results: ['"pass 2026-11-10 reviewer: shown"'],
      }),
    },
  });

test('the milestone graph: nodes, the one edge, progress, the check and the critical path', () => {
  const t = open(graphRepo());
  assert.deepEqual(t.check().problems, []);
  const mg = t.milestoneGraph();
  assert.deepEqual(
    mg.nodes.map((n) => [n.id, n.state, n.constraints, n.check, n.remaining_tokens, n.critical]),
    [
      ['W-1', 'planned', { done: 0, total: 1 }, 'not yet due', 0, true],
      ['W-7', 'planned', { done: 0, total: 2 }, 'not yet due', 301, true],
      ['W-8', 'done', { done: 1, total: 1 }, 'passed', 0, false],
    ],
  );
  // A constraint that names an item is not an edge; the one between milestones is.
  assert.deepEqual(mg.edges, [{ from: 'W-7', to: 'W-1', critical: true }]);
  assert.deepEqual(mg.critical_path, ['W-7', 'W-1']);
  const w7 = /** @type {any} */ (mg.nodes[1]);
  assert.equal(w7.outcome, 'A user with a bad config sees which key is wrong.');
  assert.equal(w7.appetite_tokens, 1000);
  assert.equal(w7.tokens_spent, null, 'the views do not read the ledger');
  assert.deepEqual(
    w7.items.map((/** @type {any} */ i) => [i.id, i.role, i.state, i.critical]),
    [
      ['W-4', 'constraint', 'planned', true],
      ['W-5', 'constraint', 'planned', true],
      ['W-9', 'contribution', 'planned', false],
    ],
  );
  assert.deepEqual([mg.nodes[0].layer, mg.nodes[1].layer, mg.nodes[2].layer], [1, 0, 0]);
  // With tokens from the ledger, over constraints and contributions.
  const spent = t.milestoneGraph({
    tokens: new Map([
      ['W-4', 120],
      ['W-9', 30],
      ['W-3', 50],
    ]),
  });
  assert.deepEqual(
    spent.nodes.map((n) => n.tokens_spent),
    [0, 150, 50],
  );
});

test('no critical path when no open milestone has estimate tokens remaining', () => {
  const t = open(makeRepo());
  const mg = t.milestoneGraph();
  assert.deepEqual(mg.critical_path, []);
  assert.deepEqual(mg.edges, []);
  assert.equal(mg.nodes[0].check, 'due', 'W-1 has no constraints left and no passed check');
});

test('views: milestones.md is the graph and the table; items-graph.md is unchanged', () => {
  const root = graphRepo();
  const t = open(root);
  const before = t.renderViewTexts();
  t.writeViews();
  const text = readFileSync(join(root, 'work', 'views', 'milestones.md'), 'utf8');
  assert.equal(
    text.split('\n```text\n')[0],
    [
      '<!-- Generated by `hitld work views`. Never edit by hand. -->',
      '',
      '# Milestones',
      '',
      '```mermaid',
      'graph LR',
      '  W_1["W-1 The goal<br/>Users trust their config.<br/>constraints 0 of 1 done<br/>— tokens, no appetite set<br/>check not yet due"]:::open',
      '  W_7["W-7 Config errors explained<br/>A user with a bad config sees which key is wrong.<br/>constraints 0 of 2 done<br/>— of 1000 tokens<br/>check not yet due"]:::open',
      '  W_8["W-8 First step shown<br/>The first step is shown.<br/>constraints 1 of 1 done<br/>— tokens, no appetite set<br/>check passed"]:::done',
      '  W_7 ==> W_1',
      '  classDef open fill:#fff,stroke:#333',
      '  classDef done fill:#ddd,color:#666,stroke:#999',
      '  classDef dropped fill:#eee,color:#999,stroke:#ccc,stroke-dasharray:3',
      '  classDef proposed fill:#fff,stroke:#333,stroke-dasharray:4',
      '  classDef critical stroke:#b3261e,stroke-width:3px',
      '  class W_7,W_1 critical',
      '```',
      '',
      'Critical path (thick edges, red outline): W-7 → W-1.',
      '',
      '| Milestone | State | Outcome | Constraints | Tokens spent | Check | Constraints and their state | Contributions and their state |',
      '|---|---|---|---|---|---|---|---|',
      '| W-1 The goal (critical path) | Planned | Users trust their config. Second sentence. | 0 of 1 done | — tokens, no appetite set | not yet due | W-7 Planned | — |',
      '| W-7 Config errors explained (critical path) | Planned | A user with a bad config sees which key is wrong. | 0 of 2 done | — of 1000 tokens | not yet due | W-4 Planned (critical path), W-5 Planned (critical path) | W-9 Planned |',
      '| W-8 First step shown | Done | The first step is shown. | 1 of 1 done | — tokens, no appetite set | passed | W-3 Done | — |',
      '',
      'Tokens spent come from the ledger in the private store, so this view shows — for them; `hitld dashboard` shows the figures. The item graph is in [items-graph.md](items-graph.md).',
      '',
      '## Unmet clauses, scope and shaping',
      '',
    ].join('\n'),
  );
  assert.ok(text.includes(before.milestones), 'the text view follows the table');
  assert.equal(before['milestones-graph'], text.split('```mermaid\n')[1].split('```')[0]);
  // items-graph.md is the item graph alone, as before: no milestone in it.
  const items = readFileSync(join(root, 'work', 'views', 'items-graph.md'), 'utf8');
  assert.equal(
    items,
    `<!-- Generated by \`hitld work views\`. Never edit by hand. -->\n\n# Item dependencies\n\n\`\`\`mermaid\n${before['items-graph']}\`\`\`\n`,
  );
  assert.doesNotMatch(items, /W_[178]\b/);
});

test('hitld dashboard adds the graph to its page as inline SVG; each node opens to its items with no script', async () => {
  const root = graphRepo();
  settings(root);
  const r = await hitld(
    ['dashboard', '--out', 'out', '--json', '--now', '2026-11-16T12:00:00Z'],
    root,
  );
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.warnings, undefined);
  assert.deepEqual(r.json.report.milestones.critical_path, ['W-7', 'W-1']);
  assert.deepEqual(
    r.json.report.milestones.nodes.map((/** @type {any} */ n) => n.tokens_spent),
    [0, 0, 0],
    'an empty ledger: nothing spent',
  );
  const html = readFileSync(join(root, 'out', 'dashboard.html'), 'utf8');
  assert.doesNotMatch(html, /<script|https?:\/\/|@import|url\(|<link|src=/i);
  assert.match(html, /<h2 id="milestones">Milestones<\/h2>/);
  assert.match(
    html,
    /<svg class="mg" [^>]*aria-label="Milestone graph: 3 milestones, 1 needs between them"/,
  );
  // Each node links to its panel; a panel shows only as the page's target.
  for (const id of ['W-1', 'W-7', 'W-8']) {
    assert.match(html, new RegExp(`<a href="#milestone-${id}"`));
    assert.match(html, new RegExp(`<section class="drill" id="milestone-${id}">`));
  }
  assert.match(html, /\.drill\{display:none;[^}]*\}\.drill:target\{display:block\}/);
  const panel = /<section class="drill" id="milestone-W-7">.*?<\/section>/s.exec(html)?.[0] ?? '';
  assert.match(
    panel,
    /<tr><td>W-4 Second step<\/td><td>constraint<\/td><td>Planned<\/td><td>yes<\/td><\/tr>/,
  );
  assert.match(
    panel,
    /<tr><td>W-9 Nice to have<\/td><td>contribution<\/td><td>Planned<\/td><td><\/td><\/tr>/,
  );
  assert.match(html, /<g class="mg-node planned critical">/);
  assert.match(html, /<g class="mg-node done">.*?check passed/s);
  assert.equal((html.match(/class="mg-edge critical"/g) ?? []).length, 1);
  assert.match(html, /Critical path \(red\): W-7 → W-1\./);
});

test('the dashboard counts tokens spent from the ledger, with corrections, against the appetite', () => {
  const t = open(graphRepo());
  const ledger = [
    { id: 'E-1', item: 'W-4', event: 'reported', tokens: 100 },
    { id: 'E-2', item: 'W-4', event: 'reported', tokens: 120, corrects: 'E-1' },
    { id: 'E-3', item: 'W-9', event: 'reported', tokens: 30 },
  ];
  const { policy } = resolvePolicy({ schema_version: 1, project: { id: 'fixture', key: 'W' } });
  const report = buildReport({
    policy: /** @type {any} */ (policy),
    ledger,
    milestones: t.milestoneGraph({ tokens: tokensPerItem(ledger) }),
  });
  assert.equal(report.milestones?.nodes[1].tokens_spent, 150);
  assert.match(renderHtml(report, /** @type {any} */ (policy)), />150 of 1000 tokens</);
  // No tracker: no section.
  assert.doesNotMatch(
    renderHtml(buildReport({ policy: /** @type {any} */ (policy) }), /** @type {any} */ (policy)),
    /id="milestones"/,
  );
});
