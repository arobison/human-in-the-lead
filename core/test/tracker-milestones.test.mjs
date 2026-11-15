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
import { schemas } from '../lib/schema/registry.mjs';
import { commitAll, git, itemText, makeRepo, policyFor, put } from './tracker-fixture.mjs';

const open = (/** @type {string} */ root) =>
  openTracker({ repoRoot: root, policy: policyFor(), env: {} });

/** A capability milestone W-7 under W-2. @param {Record<string, string | string[]>} [extra] */
const milestone = (extra = {}) =>
  itemText({
    id: 'W-7',
    title: 'Config errors explained',
    kind: 'capability',
    status: 'Planned',
    project: 'W-2',
    outcome: 'A user with a bad config sees which key is wrong.',
    done_when: ['"c1: An unknown key exits with status 2."', '"c2: The message names the line."'],
    needs: ['W-4 c1', 'W-5 c2'],
    ...extra,
  });

/** @param {Record<string, string>} files */
const problems = (files) => open(makeRepo({ files })).check().problems;

/** @param {string[]} argv @param {string} cwd */
async function hitld(argv, cwd) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: {} });
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
    needs: ['W-4 c3'],
    contributions: ['W-4 value=3 confidence=0.5'],
    deadline: '2027-01-01',
  });
  assert.deepEqual(m.problems, [
    'deadline "2027-01-01" isn\'t "<YYYY-MM-DD> <source>": an external date needs its source',
    'done_when: clause c1 appears twice',
    "needs W-4 names clause c3, which done_when doesn't have",
    'W-4 is both a constraint and a contribution; it is one or the other',
  ]);
  assert.deepEqual(storedMilestoneField('needs', [{ id: 'W-4', clause: null }]), ['W-4 c?']);
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
    },
  });
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  const e = t.get('W-7');
  assert.equal(e.parent, 'W-2');
  assert.deepEqual(e.needs, [
    { id: 'W-4', clause: 'c1' },
    { id: 'W-5', clause: 'c2' },
  ]);
  assert.deepEqual(e.check, { kind: 'integration-test', target: 'test/config/errors.test.ts' });
  assert.equal(e.appetite_tokens, 400000);
  const stored = [
    'body',
    'path',
    'version',
    'error',
    'check_due',
    'scope',
    'tokens_spent',
    'cost_of_delay_rate',
    'to_shape',
  ];
  const canonical = Object.fromEntries(Object.entries(e).filter(([k]) => !stored.includes(k)));
  assert.deepEqual(schemas().validateTrackerEntity({ schema_version: 1, ...canonical }), []);
  for (const derived of ['error', 'check_due', 'scope', 'tokens_spent', 'cost_of_delay_rate']) {
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
    /^(error|check_due|scope|to_shape):/m.test(
      readFileSync(join(root, 'work/milestones/W-7-config-errors-explained.md'), 'utf8'),
    ),
    false,
    'derived fields are never written',
  );
});

test('the check: clauses exist, contributions are scored, references resolve, no cycle runs through a milestone', () => {
  const found = problems({
    'work/milestones/W-7-config-errors-explained.md': milestone({
      needs: ['W-4 c9', 'W-99 c1', 'W-1 c2'],
      contributions: ['W-6 value=0 confidence=0.5', 'W-2 value=3 confidence=0.5'],
      status: 'In progress',
    }),
    'work/milestones/W-8-other.md': itemText({
      id: 'W-8',
      title: 'Other',
      kind: 'learning',
      status: 'Planned',
      project: 'W-2',
      initiative: 'W-1',
      needs: ['W-9 c?'],
    }),
    'work/items/W-9-loop.md': itemText({
      id: 'W-9',
      title: 'Loop',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
      needs: ['W-8'],
    }),
  });
  for (const p of [
    'work/milestones/W-7-config-errors-explained.md: a milestone is never In progress: items are claimed, milestones are not',
    "work/milestones/W-7-config-errors-explained.md: needs W-4 names clause c9, which done_when doesn't have",
    "work/milestones/W-7-config-errors-explained.md: contributions: W-6: value 0 isn't a number above 0",
    'work/milestones/W-8-other.md: a milestone needs one parent: project or initiative',
  ]) {
    assert.ok(found.includes(p), `missing: ${p}\n${found.join('\n')}`);
  }
  const refs = problems({
    'work/milestones/W-7-config-errors-explained.md': milestone({
      needs: ['W-99 c1', 'W-1 c2'],
      contributions: ['W-2 value=3 confidence=0.5'],
    }),
    'work/milestones/W-8-other.md': itemText({
      id: 'W-8',
      title: 'Other',
      kind: 'learning',
      status: 'Planned',
      project: 'W-2',
      needs: ['W-9 c?'],
    }),
    'work/items/W-9-loop.md': itemText({
      id: 'W-9',
      title: 'Loop',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
      needs: ['W-8'],
    }),
  });
  for (const p of [
    "work/milestones/W-7-config-errors-explained.md: needs W-99, which doesn't exist",
    'work/milestones/W-7-config-errors-explained.md: needs W-1, a initiative; needs name items and milestones only',
    'work/milestones/W-7-config-errors-explained.md: contributions W-2, a project; contributions are items',
    'cycle: W-9 → W-8 → W-9',
  ]) {
    assert.ok(refs.includes(p), `missing: ${p}\n${refs.join('\n')}`);
  }
});

test('Done only from a recorded passing check by a role other than the items’ authors', () => {
  const files = (/** @type {string[]} */ results, status = 'Done', kind = 'capability') => ({
    'work/milestones/W-7-config-errors-explained.md': milestone({
      kind,
      status,
      needs: ['W-3 c1'],
      done_when: ['"c1: It works."'],
      ...(results.length ? { check_results: results.map((r) => `"${r}"`) } : {}),
    }),
  });
  const say = (/** @type {string[]} */ ps) =>
    ps.filter((p) => p.includes('W-7') && p.includes('Done needs'));
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
    say(problems(files(['verdict 2026-12-01 researcher: study FB-3 says no'], 'Done', 'learning'))),
    [],
    'a learning milestone is Done when its study has a verdict, whatever it says',
  );
  assert.equal(
    say(problems(files(['pass 2026-12-01 researcher: x'], 'Done', 'learning'))).length,
    1,
  );

  // A role named in the items' commits is an author too.
  const root = makeRepo({ files: files(['pass 2026-12-01 reviewer: looked'], 'Planned') });
  put(root, { 'note.txt': 'x\n' });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'work', '-m', 'Work-Item: W-3\nAgent-Role: reviewer');
  const t = open(root);
  assert.throws(
    () => t.transition('W-7', 'Done', '', {}),
    /Done only from a recorded passing check by a role other than its items' authors \(executor, reviewer\)/,
  );
  assert.throws(
    () => t.transition('W-7', 'In progress', '', {}),
    /lifecycle allows|milestones are not/,
  );
});

test('derived: error, check_due, scope, to_shape and tokens_spent are computed, never stored', () => {
  /** @type {Record<string, Record<string, unknown>>} */
  const byId = {
    'W-4': { status: 'Done', estimate_tokens: '100' },
    'W-5': { status: 'Planned', estimate_tokens: '200' },
    'W-6': { status: 'Planned', estimate_tokens: '300' },
    'W-8': { status: 'Planned', estimate_tokens: '50' },
    'W-9': { status: 'Planned' },
  };
  const d = {
    id: 'W-7',
    kind: 'capability',
    status: 'Planned',
    done_when: ['c1: one', 'c2: two'],
    needs: ['W-4 c1', 'W-5 c2', 'W-10 c?'],
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
  assert.deepEqual(x.error, [
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
  byId['W-5'].status = 'Done';
  byId['W-10'] = { status: 'Done' };
  const due = milestoneDerived(d, ctx);
  assert.equal(due.check_due, true);
  const passed = milestoneDerived(
    { ...d, check_results: ['pass 2026-12-01 owner: demo ran'] },
    ctx,
  );
  assert.equal(passed.check_due, false);
  assert.deepEqual(passed.error, []);
  assert.equal(milestoneDerived({ ...d, appetite_tokens: '100' }, ctx).scope.too_big, true);
});

test('the read API returns milestones with api_version, and work new makes one Proposed', async () => {
  const root = makeRepo({
    files: { 'work/milestones/W-7-config-errors-explained.md': milestone() },
  });
  settings(root);
  const show = await hitld(['work', 'show', 'W-7', '--json'], root);
  assert.equal(show.code, 0);
  assert.equal(show.json.api_version, 1);
  assert.equal(show.json.entity.kind, 'capability');
  assert.equal(show.json.entity.check_due, false);
  assert.deepEqual(
    show.json.entity.error.map((/** @type {any} */ e) => e.clause),
    ['c1', 'c2'],
  );
  const query = await hitld(['work', 'query', '--kind', 'capability', '--json'], root);
  assert.deepEqual(
    query.json.entities.map((/** @type {any} */ e) => e.id),
    ['W-7'],
  );
  const made = await hitld(
    [
      'work',
      'new',
      '--kind',
      'learning',
      '--title',
      'Which cache key',
      '--parent',
      'W-1',
      '--outcome',
      'We know which key to use.',
    ],
    root,
  );
  assert.equal(made.code, 0, JSON.stringify(made.json));
  const text = readFileSync(join(root, made.json.path), 'utf8');
  assert.match(
    text,
    /^---\nid: W-8\ntitle: Which cache key\nkind: learning\nstatus: Proposed\ncreated: [\d-]+\ninitiative: W-1\noutcome: We know which key to use\.\n---/,
  );
  assert.equal(made.json.path, 'work/milestones/W-8-which-cache-key.md');
  assert.deepEqual(open(root).check().problems, []);
});

test('views: milestones with their error and scope, and the merged-but-unreleased stock', () => {
  const root = makeRepo({
    files: {
      'work/milestones/W-7-config-errors-explained.md': milestone({
        needs: ['W-3 c1', 'W-4 c?'],
        contributions: ['W-5 value=3 confidence=0.5'],
        appetite_tokens: '1000',
      }),
    },
  });
  const texts = open(root).renderViewTexts();
  assert.equal(
    texts.milestones,
    [
      'W-7 Config errors explained [Planned], capability, under W-2 The project',
      '  outcome: A user with a bad config sees which key is wrong.',
      '  constraints: 1 of 2 done',
      '  error: c1 An unknown key exits with status 2. (check not passed)',
      '  error: c2 The message names the line. (check not passed)',
      '  error: not linked to a clause yet (open: W-4; check not passed)',
      '  scope: appetite 1000; constraints 0 tokens; in scope: none; not sized: W-5',
      '  to shape: check; link W-4 to a clause',
      '',
      '1 open milestone(s)',
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
    files: {
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
    /^migrate: milestone-entities, retire-priority$/,
  );
  assert.equal(git(root, 'status', '--porcelain'), '');
  const alpha = readFileSync(join(root, 'work/milestones/W-7-alpha.md'), 'utf8');
  assert.match(
    alpha,
    /^---\nid: W-7\ntitle: Alpha\nkind: capability\nstatus: Planned\ncreated: 2026-11-01\nproject: W-2\nneeds: \[W-4 c\?, W-5 c\?\]\n---\n/,
  );
  assert.match(alpha, /From W-2:\n\n- \*\*alpha\*\* \(capability\)\. Outcome: it starts\./);
  assert.ok(existsSync(join(root, 'work/milestones/W-8-beta-two.md')));
  const project = readFileSync(join(root, 'work/projects/W-2-the-project.md'), 'utf8');
  assert.equal(project.includes('milestones:'), false);
  assert.ok(project.includes('title: "The project"'), 'other lines are left as they were');
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
        status: 'Planned',
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
      status: 'Planned',
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
    'W-4': { status: 'Planned', estimate_tokens: '100' },
    'W-5': { status: 'Planned', estimate_tokens: '100' },
    'W-6': { status: 'Planned', estimate_tokens: '100' },
  };
  const d = {
    id: 'W-7',
    kind: 'capability',
    status: 'Planned',
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
