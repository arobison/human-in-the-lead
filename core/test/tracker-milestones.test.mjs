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
import {
  compareVersions,
  fileHref,
  forgeFileBase,
  milestoneFacts,
} from '../lib/tracker/files/views.mjs';
import {
  buildReport,
  renderHtml,
  renderMilestoneSection,
  tokensPerItem,
} from '../lib/quota/report.mjs';
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
import { assertPageSafe } from './helpers/page-safety.mjs';

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

/** The column heads of a board's SVG. @param {string} svg */
const heads = (svg) =>
  [...svg.matchAll(/<text class="mg-step"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

/** Each release flag of a board's SVG by version, in drawing order. @param {string} svg */
function flagsOf(svg) {
  /** @type {Record<string, { x: number, y: number, text: string }>} */
  const flags = {};
  for (const m of svg.matchAll(
    /<g class="mg-flag \w+"><title>Release gate (\S+): (W-\d+)[^<]*<\/title><line x1="([\d.]+)" x2="[\d.]+" y1="([\d.]+)"[^]*?<text [^>]*>([^<]*)<\/text><\/g>/g,
  )) {
    flags[m[1]] = { x: Number(m[3]), y: Number(m[4]), text: m[5] };
  }
  return flags;
}

/** Each milestone box's left edge in a board's SVG. @param {string} svg */
const boxesOf = (svg) =>
  Object.fromEntries(
    [
      ...svg.matchAll(
        /<a href="#milestone-(W-\d+)" [^>]*><g class="[^"]*"><title>[^<]*<\/title><rect class="mg-box" x="([\d.]+)"/g,
      ),
    ].map((m) => [m[1], Number(m[2])]),
  );

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
      'work/items/W-10-ship-it.md': itemText({
        id: 'W-10',
        title: 'Ship it',
        kind: 'work',
        state: 'planned',
        project: 'W-2',
        release: '1.0.0',
        needs: ['W-5'],
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
  assert.deepEqual(mg.edges, [{ from: 'W-7', to: 'W-1', critical: true, items: 2 }]);
  // The board's fields: the stage, what holds a milestone up, its lane and the release gates.
  assert.deepEqual(
    mg.nodes.map((n) => [n.id, n.stage, n.in_progress, n.holds, n.in_cycle]),
    [
      ['W-1', 'waiting', 0, { decisions: [], owner_decisions: [], external: [] }, false],
      ['W-7', 'ready', 0, { decisions: ['W-6'], owner_decisions: ['W-6'], external: [] }, false],
      ['W-8', 'done', 0, { decisions: [], owner_decisions: [], external: [] }, false],
    ],
  );
  assert.deepEqual(mg.lanes, [
    { id: null, title: 'Long outcomes', state: null },
    { id: 'W-2', title: 'project', state: 'planned' },
  ]);
  assert.deepEqual(mg.releases, [
    // W-10 needs W-5, a constraint of W-7: W-7 lands before it, and it stands at W-7's step.
    {
      id: 'W-10',
      title: 'Ship it',
      release: '1.0.0',
      state: 'planned',
      layer: 0,
      milestones: ['W-7'],
      path: 'work/items/W-10-ship-it.md',
      needs: [
        { id: 'W-5', title: 'Third step', state: 'planned', path: 'work/items/W-5-third-step.md' },
      ],
    },
  ]);
  assert.deepEqual(
    mg.nodes.map((n) => [n.id, n.waits, n.waiting_on_it]),
    [
      ['W-1', ['W-7'], 0],
      ['W-7', [], 1],
      ['W-8', [], 0],
    ],
  );
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
  // With tokens from the ledger, over constraints and contributions; a milestone none of whose
  // items the ledger has a record of shows a dash (null), not 0.
  const spent = t.milestoneGraph({
    tokens: new Map([
      ['W-4', 120],
      ['W-9', 30],
      ['W-3', 50],
    ]),
  });
  assert.deepEqual(
    spent.nodes.map((n) => n.tokens_spent),
    [null, 150, 50],
  );
  assert.equal(milestoneFacts(spent.nodes[0]).tokens, '— tokens, no appetite set');
  assert.equal(milestoneFacts(spent.nodes[1]).tokens, '150 of 1000 tokens');
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
      // Each ID links to its file, relative to the views directory.
      '| [W-1](../milestones/W-1-goal.md) The goal (critical path) | Planned | Users trust their config. Second sentence. | 0 of 1 done | — tokens, no appetite set | not yet due | [W-7](../milestones/W-7-config-errors-explained.md) Planned | — |',
      '| [W-7](../milestones/W-7-config-errors-explained.md) Config errors explained (critical path) | Planned | A user with a bad config sees which key is wrong. | 0 of 2 done | — of 1000 tokens | not yet due | [W-4](../items/W-4-second-step.md) Planned (critical path), [W-5](../items/W-5-third-step.md) Planned (critical path) | [W-9](../items/W-9-nice-to-have.md) Planned |',
      '| [W-8](../milestones/W-8-first-step-shown.md) First step shown | Done | The first step is shown. | 1 of 1 done | — tokens, no appetite set | passed | [W-3](../items/W-3-first-step.md) Done | — |',
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
    [null, null, null],
    'an empty ledger: not known, so a dash rather than 0',
  );
  const html = readFileSync(join(root, 'out', 'dashboard.html'), 'utf8');
  assertPageSafe(html);
  assert.match(html, /<h2 id="milestones">Milestones<\/h2>/);
  assert.match(
    html,
    /<svg class="mg" [^>]*aria-label="Milestone board: 3 milestones in 3 lanes over 2 columns, 1 waits between them"/,
  );
  // Each node links to its panel; a panel shows only as the page's target.
  for (const id of ['W-1', 'W-7', 'W-8']) {
    assert.match(html, new RegExp(`<a href="#milestone-${id}"`));
    assert.match(
      html,
      new RegExp(
        `<section class="drill" id="milestone-${id}" aria-labelledby="milestone-${id}-title">`,
      ),
    );
  }
  assert.match(html, /\.drill\{display:none;[^}]*\}\.drill:target\{display:block\}/);
  const panel = /<section class="drill" id="milestone-W-7" .*?<\/section>/s.exec(html)?.[0] ?? '';
  assert.match(
    panel,
    /<tr><td><a class="file" href="work\/items\/W-4-second-step\.md">W-4<\/a> Second step<\/td><td>constraint<\/td><td>Planned<\/td><td>yes<\/td><\/tr>/,
  );
  assert.match(
    panel,
    /<tr><td><a class="file" href="work\/items\/W-9-nice-to-have\.md">W-9<\/a> Nice to have<\/td><td>contribution<\/td><td>Planned<\/td><td><\/td><\/tr>/,
  );
  // Lanes with their names, top to bottom: the release gates first, then long outcomes, then
  // each project; release stages across.
  assert.deepEqual(
    [...html.matchAll(/<text class="mg-lane-name" x="8" y="(\d+)">([^<]*)<\/text>/g)]
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => m[2]),
    ['Releases', 'Long outcomes', 'project'],
  );
  assert.match(
    html,
    /<rect class="mg-lane" x="0" y="26" [^>]*\/><text class="mg-lane-name" x="8" y="\d+">Releases</,
  );
  assert.ok(!html.includes('>0 tokens'), 'no card claims 0 tokens without a ledger record');
  // The release's rule runs from its flag down through every lane, behind the boxes; W-7, which
  // lands before it, carries its version.
  const height = /<svg class="mg" width="\d+" height="(\d+)"/.exec(html)?.[1];
  assert.match(
    html,
    new RegExp(
      `<g class="mg-rule open"><line class="mg-rule-top" [^>]*/><line class="mg-rule-down" [^>]*y2="${height}"/></g>`,
    ),
  );
  assert.ok(
    html.indexOf('class="mg-rule') < html.indexOf('class="mg-node'),
    'rules are drawn first',
  );
  assert.match(
    html,
    /<g class="mg-badge release"><title>Lands before release 1\.0\.0 \(W-10\)<\/title>/,
  );
  assert.match(html, /Release gate 1\.0\.0: W-10 Ship it \(Planned\); after W-7/);
  // Proposal tables stack their cells at phone width, with each cell's label, and no script.
  assert.match(html, /@media \(max-width:600px\)\{\.mg-props thead\{display:none\}/);
  assert.match(html, /\.mg-props td\[data-label\]::before\{content:attr\(data-label\) ": "/);
  // The board's columns are release stages: W-7 lands before 1.0.0; W-1 and W-8, which no
  // release needs, stand after it.
  const board = /<svg class="mg" [\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
  assert.deepEqual(
    [...board.matchAll(/<text class="mg-step"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]),
    ['Before 1.0.0', 'No release'],
  );
  // Not started: hollow, with a stage dot; started or done: solid, with a strip.
  assert.match(html, /<g class="mg-node ready hollow critical">.*?<circle class="mg-dot"/s);
  assert.match(html, /<g class="mg-node waiting hollow critical">/);
  assert.match(html, /<g class="mg-node done started">.*?<rect class="mg-strip".*?check passed/s);
  // What holds W-7 up shows as a badge by its name.
  assert.match(
    html,
    /<g class="mg-badge decision"><title>Held up by W-6<\/title>.*?>1 decision<\/text>/s,
  );
  // The one wait: on the critical path, with two items behind it, so not dashed.
  assert.equal((board.match(/class="mg-edge critical"/g) ?? []).length, 1);
  assert.match(html, /W-1 waits on W-7: 2 item\(s\) behind the wait, on the critical path/);
  assert.match(html, /Critical path: W-7 → W-1\./);
  for (const stage of ['proposed', 'waiting', 'ready', 'in-flight', 'done']) {
    assert.match(html, new RegExp(`<i class="sw ${stage}"></i>`));
  }
  assert.match(html, /--st-flight:#b08cf6;/);
  assert.match(html, /--st-flight:#9b7fe6;/);
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
  assert.match(renderHtml(report), />150 of 1000 tokens</);
  // No tracker: no section.
  assert.doesNotMatch(
    renderHtml(buildReport({ policy: /** @type {any} */ (policy) })),
    /id="milestones"/,
  );
});

test('escaping: a title with a backslash, a pipe, a quote and &lt; shows as written in the graph, the table and the page', async () => {
  const title = String.raw`Paths like C:\dir | "quoted" &lt; less`;
  const root = makeRepo({
    files: {
      'work/milestones/W-7-config-errors-explained.md': milestone({ title }),
    },
  });
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.equal(t.milestoneGraph().nodes[1].title, title);
  // Mermaid: each character as an entity code, the backslash and & included; nothing raw.
  const mermaid = t.renderViewTexts()['milestones-graph'];
  assert.match(
    mermaid,
    /\n {2}W_7\["W-7 Paths like C:#92;dir \| #quot;quoted#quot; #38;lt; less<br\/>/,
  );
  const label = /\n {2}W_7\["(.*?)"\]/.exec(mermaid)?.[1] ?? '';
  assert.doesNotMatch(label, /[\\"&]/);
  // The table: the backslash escaped before the pipe, so the pipe stays escaped; & as an entity.
  t.writeViews();
  const view = readFileSync(join(root, 'work', 'views', 'milestones.md'), 'utf8');
  assert.match(
    view,
    /\n\| \[W-7\]\(\.\.\/milestones\/W-7-config-errors-explained\.md\) Paths like C:\\\\dir \\\| "quoted" &amp;lt; less \(critical path\) \| Planned \|/,
  );
  // The page: HTML-escaped.
  settings(root);
  const r = await hitld(['dashboard', '--out', 'out', '--now', '2026-11-16T12:00:00Z'], root);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  const html = readFileSync(join(root, 'out', 'dashboard.html'), 'utf8');
  assert.match(html, /W-7 Paths like C:\\dir \| &quot;quoted&quot; &amp;lt; less/);
  assert.doesNotMatch(html, /"quoted"|[^&]&lt; less/);
});

test('escaping: a backslash before a pipe and a trailing backslash cannot unescape the table or the graph', async () => {
  const title = 'A pipe after a backslash \\| and one at the end \\';
  const root = makeRepo({
    files: { 'work/milestones/W-7-config-errors-explained.md': milestone({ title }) },
  });
  const t = open(root);
  assert.equal(t.milestoneGraph().nodes[1].title, title);
  t.writeViews();
  const view = readFileSync(join(root, 'work', 'views', 'milestones.md'), 'utf8');
  const row = view.split('\n').find((l) => l.startsWith('| [W-7]')) ?? '';
  // Each backslash doubled, then the pipe escaped: no `|` in the title is left unescaped.
  assert.ok(
    row.startsWith(
      '| [W-7](../milestones/W-7-config-errors-explained.md) A pipe after a backslash \\\\\\| and one at the end \\\\ (critical path) | Planned |',
    ),
    row,
  );
  // The row splits into the table's eight cells, as a markdown reader splits it.
  assert.equal(row.replace(/\\\\/g, '').replace(/\\\|/g, '').split('|').length - 2, 8);
  const mermaid = t.renderViewTexts()['milestones-graph'];
  assert.match(mermaid, /W_7\["W-7 A pipe after a backslash #92;\| and one at the end #92;<br\/>/);
  settings(root);
  assert.equal(
    (await hitld(['dashboard', '--out', 'out', '--now', '2026-11-16T12:00:00Z'], root)).code,
    0,
  );
  const html = readFileSync(join(root, 'out', 'dashboard.html'), 'utf8');
  assert.ok(
    html.includes(
      '<h3 id="milestone-W-7-title"><a class="file" href="work/milestones/W-7-config-errors-explained.md">W-7</a> A pipe after a backslash \\| and one at the end \\</h3>',
    ),
  );
});

test('the board draws proposed milestones dashed and marked, still lists them under it, and marks a loop', () => {
  const mg = open(graphRepo()).milestoneGraph();
  const w7 = /** @type {any} */ (mg.nodes[1]);
  w7.state = 'proposed';
  w7.stage = 'proposed';
  /** @type {any} */ (mg.nodes[0]).in_cycle = true;
  const html = renderMilestoneSection(mg);
  // On the board (decision HITLD-419): hollow, with the proposed class the dashed border hangs
  // on, a "proposed" mark by its name, in the column its release gives it, in both layouts.
  const node = (/** @type {string} */ svg) =>
    new RegExp(
      `<a href="#milestone-W-7" aria-label="W-7 Config errors explained, Proposed, not committed[^"]*"[^>]*><g class="mg-node proposed hollow[^"]*">.*?<g class="mg-badge proposed"><title>Proposed: not committed yet</title>.*?>proposed</text>`,
      's',
    ).test(svg);
  const [lanes, fewest] = [...html.matchAll(/<svg class="mg" [\s\S]*?<\/svg>/g)].map((m) => m[0]);
  assert.ok(node(lanes) && node(fewest), 'drawn and marked in both layouts');
  // Proposals as a table: the idea, what stands between it and committing, what waits on it.
  assert.match(
    html,
    /<h3 class="mg-h">Proposed milestones: what stands between each and committing<\/h3>.*?<table class="mg-props">/s,
  );
  assert.match(
    html,
    /<tr><td data-label="Idea"><a href="#milestone-W-7">W-7 Config errors explained<\/a><\/td><td data-label="Before committing">Waits on your answer: W-6<\/td><td data-label="Waiting on it">1<\/td><\/tr>/,
  );
  assert.doesNotMatch(html, /Dropped milestones/);
  assert.match(html, /<section class="drill" id="milestone-W-7" /, 'its drawer is still there');
  // A loop: an amber border and a mark; the dashed border is the proposed one alone.
  assert.match(html, /<g class="mg-node waiting hollow critical loop[^"]*">.*?>in a loop<\/text>/s);
  assert.match(html, /<span>Dashed border: proposed, not committed<\/span>/);
  assert.match(html, /<span>Amber border: in a loop of needs<\/span>/);
  assert.match(html, /3 milestones in 3 lanes/);
});

test('proposals: whole proposed projects first, then lone milestones; other waits named; dropped in their own table', () => {
  const mg = open(graphRepo()).milestoneGraph();
  const [w1, w7, w8] = /** @type {any[]} */ (mg.nodes);
  w1.state = 'proposed';
  w7.state = 'proposed';
  w8.state = 'dropped';
  /** @type {any} */ (mg.lanes[1]).state = 'proposed';
  const html = renderMilestoneSection(mg);
  const rows = [...html.matchAll(/<tr( class="mg-group")?>(.*?)<\/tr>/g)].map((m) =>
    m[2].replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'),
  );
  assert.deepEqual(rows.slice(1, 5), [
    '|W-2 project, a proposed project|',
    '|W-7 Config errors explained|Waits on your answer: W-6|1|',
    '|Lone milestones|',
    '|W-1 The goal|Waits on other items: W-7|0|',
  ]);
  assert.match(
    html,
    /<h3 class="mg-h">Dropped milestones<\/h3>.*?<td data-label="Idea"><a href="#milestone-W-8">W-8 First step shown<\/a><\/td><td data-label="Constraints">1 of 1 done<\/td>/s,
  );
  // The proposed ones stand on the board too; the dropped one does not.
  assert.match(html, /2 milestones in 3 lanes/);
  assert.doesNotMatch(html, /<a href="#milestone-W-8" aria-label/);
});

test('versions order as semantic versions: numbers by value, a pre-release before its release', () => {
  assert.deepEqual(
    ['1.0.0', '0.1.0', '0.1.0-rc.10', '0.1.0-rc.2', '0.0.9', '0.1.0-rc.1'].sort(compareVersions),
    ['0.0.9', '0.1.0-rc.1', '0.1.0-rc.2', '0.1.0-rc.10', '0.1.0', '1.0.0'],
  );
});

test('release flags: each at the right edge of its stage, in stage order; where the needs and a release disagree, the needs win', () => {
  // As on this repository's tracker: a done pre-release that needs only items (rc.1), an open
  // pre-release that needs a milestone (rc.2 needs W-1, at the second step), and the release
  // (0.1.0), which needs both pre-releases and an item of W-7 (the first step).
  const root = graphRepo();
  const gate = (/** @type {Record<string, string | string[]>} */ f) =>
    itemText({ kind: 'work', project: 'W-2', ...f });
  put(root, {
    'work/items/W-10-ship-it.md': gate({
      id: 'W-10',
      title: 'Release 0.1.0',
      state: 'planned',
      release: '0.1.0',
      needs: ['W-5', 'W-11', 'W-12'],
    }),
    'work/items/W-11-rc-1.md': gate({
      id: 'W-11',
      title: 'Release 0.1.0-rc.1',
      state: 'done',
      release: '0.1.0-rc.1',
      needs: ['W-3'],
    }),
    'work/items/W-12-rc-2.md': gate({
      id: 'W-12',
      title: 'Release 0.1.0-rc.2',
      state: 'planned',
      release: '0.1.0-rc.2',
      needs: ['W-1'],
    }),
  });
  commitAll(root, 'release gates');
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  const mg = t.milestoneGraph();
  assert.deepEqual(
    mg.releases.map((r) => [r.release, r.state, r.layer, r.milestones]),
    [
      // rc.1 needs W-3, a constraint of W-8; done, it stands before the first step all the same.
      ['0.1.0-rc.1', 'done', -1, ['W-8']],
      // rc.2 needs W-1, at the second step (layer 1).
      ['0.1.0-rc.2', 'planned', 1, ['W-1']],
      // 0.1.0 needs W-7 (layer 0), but never stands left of rc.2, which it needs.
      ['0.1.0', 'planned', 1, ['W-7']],
    ],
  );
  // The board's columns (decision HITLD-420): rc.1 needs W-8, rc.2 needs W-1, and 0.1.0 needs
  // W-7; but W-1 needs W-7, so W-7 stands before rc.2 with W-1, a column to its left, and the
  // board says so. 0.1.0 has nothing left in its stage: its flag stands just right of rc.2's.
  const html = renderMilestoneSection(mg);
  const [lanes, fewest] = [...html.matchAll(/<svg class="mg" [\s\S]*?<\/svg>/g)].map((m) => m[0]);
  assert.deepEqual(heads(lanes), [
    'Before 0.1.0-rc.1',
    'Before 0.1.0-rc.2, step 1',
    'Before 0.1.0-rc.2, step 2',
  ]);
  for (const svg of [lanes, fewest]) {
    const flags = flagsOf(svg);
    const box = boxesOf(svg);
    assert.deepEqual(
      Object.keys(flags),
      ['0.1.0-rc.1', '0.1.0-rc.2', '0.1.0'],
      'one row each, in stage order',
    );
    assert.equal(new Set(Object.values(flags).map((f) => f.y)).size, 3);
    assert.ok(box['W-8'] + 230 < flags['0.1.0-rc.1'].x, 'rc.1 right of its milestone');
    assert.ok(flags['0.1.0-rc.1'].x < box['W-7'], 'and left of the next stage');
    assert.ok(box['W-7'] < box['W-1'], 'W-1 a column right of W-7, which it needs');
    assert.ok(box['W-1'] + 230 < flags['0.1.0-rc.2'].x, 'rc.2 right of both');
    assert.ok(flags['0.1.0-rc.2'].x < flags['0.1.0'].x, 'rc.2 left of 0.1.0');
    // The board is wide enough for every label.
    const width = Number(/<svg class="mg" width="(\d+)"/.exec(svg)?.[1]);
    for (const f of Object.values(flags)) assert.ok(f.x + 16 + f.text.length * 7 <= width);
  }
  assert.match(
    html,
    /<title>Release gate 0\.1\.0: W-10 Release 0\.1\.0 \(Planned\); after W-7<\/title>/,
  );
  assert.match(
    html,
    /Where a milestone's needs and its release disagree, the needs win: W-7 stands before 0\.1\.0-rc\.2 because W-1 needs it, though the first release that needs it is 0\.1\.0\./,
  );
  assert.match(
    lanes,
    /<g class="mg-badge pulled"><title>Drawn before 0\.1\.0-rc\.2: W-1 needs it, though the first release that needs it is 0\.1\.0<\/title>.*?>needed earlier<\/text>/,
  );
  // Every release's rule runs down the board: rc.1 is done but W-8 stands in its stage.
  assert.equal((lanes.match(/<line class="mg-rule-down"/g) ?? []).length, 3);
});

/**
 * Two release stages and proposed milestones (HITLD-421): 0.1.0-rc.1 needs W-11; 1.0.0 needs rc.1
 * and the proposed W-12 and W-13; W-13 needs W-14, which no release needs; the long outcome W-15
 * needs W-11, W-12 and W-13. The fixture's own long outcome W-1 needs nothing and no release
 * needs it.
 */
const stagesRepo = () => {
  const work = (/** @type {string} */ id, /** @type {Record<string, string | string[]>} */ f) =>
    itemText({ id, kind: 'work', state: 'planned', project: 'W-2', ...f });
  const ms = (/** @type {string} */ id, /** @type {Record<string, string | string[]>} */ f) =>
    itemText({ id, kind: 'milestone', state: 'planned', project: 'W-2', ...f });
  return makeRepo({
    files: {
      '.human-in-the-lead/tracker.json': JSON.stringify({ schema_version: 1 }),
      'work/projects/W-2-the-project.md': itemText({
        id: 'W-2',
        title: 'The project',
        kind: 'project',
        state: 'planned',
        owner: 'owner',
      }),
      'work/items/W-20-share.md': work('W-20', { title: 'Share the store' }),
      'work/items/W-21-guide.md': work('W-21', { title: 'Write the guide' }),
      'work/items/W-22-windows.md': work('W-22', { title: 'Run on Windows' }),
      'work/items/W-23-hosted.md': work('W-23', { title: 'Read a hosted tracker' }),
      'work/items/W-30-rc-1.md': work('W-30', {
        title: 'Release 0.1.0-rc.1',
        release: '0.1.0-rc.1',
        needs: ['W-11'],
      }),
      'work/items/W-31-ship.md': work('W-31', {
        title: 'Release 1.0.0',
        release: '1.0.0',
        needs: ['W-30', 'W-12', 'W-13'],
      }),
      'work/milestones/W-11-store-shared.md': ms('W-11', {
        title: 'Store shared',
        outcome: 'Two sessions share one store.',
        constraints: ['W-20 c?'],
      }),
      'work/milestones/W-12-guide-followed.md': ms('W-12', {
        title: 'Guide followed',
        state: 'proposed',
        outcome: 'A new project adopts it from the guide.',
        constraints: ['W-21 c?'],
      }),
      'work/milestones/W-13-runs-on-windows.md': ms('W-13', {
        title: 'Runs on Windows',
        state: 'proposed',
        outcome: 'The suite passes on Windows.',
        constraints: ['W-22 c?', 'W-14 c?'],
      }),
      'work/milestones/W-14-hosted-tracker.md': ms('W-14', {
        title: 'Hosted tracker',
        outcome: 'A project runs on a hosted tracker.',
        constraints: ['W-23 c?'],
      }),
      'work/milestones/W-15-goal.md': itemText({
        id: 'W-15',
        title: 'The goal',
        kind: 'milestone',
        state: 'planned',
        owner: 'owner',
        outcome: 'One signal end to end.',
        constraints: ['W-11 c?', 'W-12 c?', 'W-13 c?'],
      }),
    },
  });
};

test('release stages: proposed milestones dashed on the board, columns in stage order, each flag at the right edge of its stage', async () => {
  const root = stagesRepo();
  assert.deepEqual(open(root).check().problems, []);
  settings(root);
  const r = await hitld(
    ['dashboard', '--out', 'out', '--json', '--now', '2026-11-16T12:00:00Z'],
    root,
  );
  assert.equal(r.code, 0, JSON.stringify(r.json));
  const html = readFileSync(join(root, 'out', 'dashboard.html'), 'utf8');
  // One file: one inline script, nothing fetched.
  assertPageSafe(html);
  const [lanes, fewest] = [...html.matchAll(/<svg class="mg" [\s\S]*?<\/svg>/g)].map((m) => m[0]);
  assert.match(lanes, /aria-label="Milestone board: 6 milestones in 3 lanes over 4 columns, /);
  // The columns: rc.1's stage, 1.0.0's in two steps (W-13 needs W-14), then no release.
  assert.deepEqual(heads(lanes), [
    'Before 0.1.0-rc.1',
    'Before 1.0.0, step 1',
    'Before 1.0.0, step 2',
    'No release',
  ]);
  for (const svg of [lanes, fewest]) {
    const flags = flagsOf(svg);
    const box = boxesOf(svg);
    assert.deepEqual(Object.keys(flags), ['0.1.0-rc.1', '1.0.0'], 'in stage order, one row each');
    assert.ok(flags['0.1.0-rc.1'].y < flags['1.0.0'].y);
    // rc.1 right of what it needs and left of the next stage; 1.0.0 the same.
    assert.ok(box['W-11'] + 230 < flags['0.1.0-rc.1'].x);
    for (const id of ['W-12', 'W-13', 'W-14']) {
      assert.ok(flags['0.1.0-rc.1'].x < box[id], `${id} right of rc.1`);
      assert.ok(box[id] + 230 < flags['1.0.0'].x, `${id} left of 1.0.0`);
    }
    assert.equal(box['W-12'], box['W-14'], 'one column');
    assert.ok(box['W-14'] < box['W-13'], 'W-13 right of W-14, which it needs');
    assert.ok(flags['1.0.0'].x < box['W-15'], 'what no release needs stands after every release');
    // The proposed ones: drawn, hollow, in the class the dashed border hangs on, and marked.
    for (const id of ['W-12', 'W-13']) {
      assert.match(
        svg,
        new RegExp(
          `<a href="#milestone-${id}" [^>]*><g class="mg-node proposed hollow[^"]*">(?:(?!</a>).)*>proposed</text>`,
          's',
        ),
      );
    }
    for (const id of ['W-11', 'W-14', 'W-15']) {
      assert.match(
        svg,
        new RegExp(`<a href="#milestone-${id}" [^>]*><g class="mg-node (?!proposed)`),
      );
    }
    // The waits run left to right.
    for (const m of svg.matchAll(/<g data-from="(W-\d+)" data-to="(W-\d+)">/g)) {
      assert.ok(box[m[1]] < box[m[2]], `${m[2]} right of ${m[1]}, which it needs`);
    }
  }
  assert.match(html, /\.mg-node\.proposed \.mg-box\{[^}]*stroke-dasharray:6 4/);
  // W-14 is in no release, but W-13 needs it: the needs win, and the board says so.
  assert.match(
    html,
    /W-14 stands before 1\.0\.0 because W-13 needs it, though no release needs it\./,
  );
  // The table under the board stays.
  assert.match(
    html,
    /<h3 class="mg-h">Proposed milestones: what stands between each and committing<\/h3>.*?W-12 Guide followed.*?W-13 Runs on Windows/s,
  );
});

test('file links: the forge address from the origin remote, never its credentials; else a relative path', () => {
  const base = 'https://github.com/acme/widgets/blob/HEAD';
  for (const remote of [
    'https://github.com/acme/widgets',
    'https://github.com/acme/widgets.git',
    'https://someone:secret-token@github.com/acme/widgets.git',
    'git@github.com:acme/widgets.git',
    'ssh://git@github.com/acme/widgets.git',
  ]) {
    assert.equal(forgeFileBase(remote), base, remote);
  }
  assert.equal(
    forgeFileBase('git@github.com:acme/widgets.git', 'main'),
    'https://github.com/acme/widgets/blob/main',
  );
  // A remote that is not a known forge, or none, gives no address; nor does an odd branch name.
  for (const remote of [
    'https://gitlab.example/acme/widgets.git',
    'http://127.0.0.1:9/git/acme/widgets',
    '',
    null,
  ]) {
    assert.equal(forgeFileBase(remote), null, String(remote));
  }
  assert.equal(forgeFileBase('https://github.com/acme/widgets', 'x y"z'), null);
  assert.equal(fileHref('work/items/W-4-a.md', { base }), `${base}/work/items/W-4-a.md`);
  assert.equal(fileHref('work/items/W-4-a.md', { from: 'work/views' }), '../items/W-4-a.md');
  assert.equal(fileHref('work/items/W-4-a.md'), 'work/items/W-4-a.md');
});

test('the page links every item, milestone and release ID to its file, plainly, and shows what is clickable', async () => {
  const root = graphRepo();
  settings(root);
  /** @param {string} out */
  const page = async (out) => {
    const r = await hitld(['dashboard', '--out', out, '--now', '2026-11-16T12:00:00Z'], root);
    assert.equal(r.code, 0, JSON.stringify(r.json));
    return readFileSync(join(root, out, 'dashboard.html'), 'utf8');
  };
  // No remote: repository-relative paths.
  let html = await page('out');
  const panels = [
    ...html.matchAll(/<section class="drill" id="milestone-(W-\d+)" [^>]*>(.*?)<\/section>/gs),
  ];
  assert.equal(panels.length, 3);
  for (const [, id, panel] of panels) {
    const rows = [...panel.matchAll(/<tbody>(.*?)<\/tbody>/gs)].flatMap(
      (b) => b[1].match(/<tr>.*?<\/tr>/g) ?? [],
    );
    assert.ok(rows.length, `${id} lists its items`);
    for (const row of rows) {
      assert.match(
        row,
        /^<tr><td><a class="file" href="work\/(items|milestones)\/W-\d+-[a-z0-9-]+\.md">W-\d+<\/a> /,
        row,
      );
    }
    assert.match(
      panel,
      new RegExp(
        `<h3 id="milestone-${id}-title"><a class="file" href="work/milestones/${id}-[a-z0-9-]+\\.md">${id}</a> `,
      ),
    );
  }
  // A flag opens the release's drawer, whose head links the release item's file.
  assert.match(
    html,
    /<a href="#release-W-10" aria-label="Release 1\.0\.0: W-10 Ship it"><g class="mg-flag open">/,
  );
  assert.match(
    html,
    /<h3 id="release-W-10-title">Release 1\.0\.0: <a class="file" href="work\/items\/W-10-ship-it\.md">W-10<\/a> Ship it<\/h3>/,
  );
  // Clickable: a pointer, and a visible focus outline for the keyboard.
  assert.match(html, /\.mg a\{cursor:pointer\}/);
  assert.match(html, /a:focus-visible\{outline:2px solid var\(--used\)/);
  assertPageSafe(html);
  // A GitHub origin: links on the forge, at the default branch, with no credential carried over.
  git(root, 'remote', 'add', 'origin', 'https://someone:secret-token@github.com/acme/widgets.git');
  html = await page('out2');
  assert.match(
    html,
    /<a class="file" href="https:\/\/github\.com\/acme\/widgets\/blob\/HEAD\/work\/items\/W-4-second-step\.md">W-4<\/a>/,
  );
  assert.doesNotMatch(html, /secret-token|someone@/);
});

test('drawers: closed by default, each with a Close link, every box and flag opening its own, a backdrop that closes them, no script', async () => {
  const root = graphRepo();
  settings(root);
  const r = await hitld(['dashboard', '--out', 'out', '--now', '2026-11-16T12:00:00Z'], root);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  const html = readFileSync(join(root, 'out', 'dashboard.html'), 'utf8');
  assertPageSafe(html);
  // Closed by default; a drawer shows only as the page's target, fixed on the right.
  assert.match(
    html,
    /\.drill\{display:none;box-sizing:border-box;position:fixed;top:0;right:0;bottom:0;width:min\(560px,100%\);[^}]*\}\.drill:target\{display:block\}/,
  );
  const drawers = [
    ...html.matchAll(
      /<section class="drill" id="((?:milestone|release)-W-\d+)" [^>]*>(.*?)<\/section>/gs,
    ),
  ];
  assert.deepEqual(
    drawers.map((d) => d[1]),
    ['milestone-W-1', 'milestone-W-7', 'milestone-W-8', 'release-W-10'],
  );
  for (const [, id, body] of drawers) {
    assert.match(
      body,
      /^<div class="drawer-head"><h3 id="[^"]+-title">.*?<\/h3><a class="drawer-close" href="#milestones">Close<\/a>/,
      id,
    );
    // Every box or flag on the board opens it.
    assert.match(html, new RegExp(`<a href="#${id}" aria-label="`), id);
  }
  // The release's drawer: what lands before it and what it needs, with their states.
  const release = drawers[3][2];
  assert.match(
    release,
    /Milestones that land before it \(0 of 1 done\).*?<a href="#milestone-W-7">W-7<\/a> Config errors explained<\/td><td>Planned/s,
  );
  assert.match(
    release,
    /What it needs \(0 of 1 done\).*?<a class="file" href="work\/items\/W-5-third-step\.md">W-5<\/a> Third step<\/td><td>Planned/s,
  );
  // One backdrop, out of the tab order, closing to the board; shown only while a drawer is open.
  assert.equal(
    (
      html.match(
        /<a class="drawer-backdrop" href="#milestones" aria-label="Close" tabindex="-1"><\/a>/g,
      ) ?? []
    ).length,
    1,
  );
  assert.match(
    html,
    /\.drawer-backdrop\{display:none\}body:has\(\.drill:target\) \.drawer-backdrop\{display:block;position:fixed;inset:0;z-index:20/,
  );
  // Lane backgrounds let a click through to the backdrop; boxes and flags stay above it.
  assert.match(
    html,
    /\.mg\{position:relative;z-index:25;pointer-events:none\}\.mg a\{pointer-events:auto\}/,
  );
  // Wide: beside the board. The open box and flag are marked.
  assert.match(
    html,
    /@media \(min-width:1100px\)\{body:has\(\.drill:target\)\{padding-right:min\(560px,100%\)\}\}/,
  );
  assert.match(
    html,
    /body:has\(#milestone-W-7:target\) a\[href="#milestone-W-7"\] \.mg-box\{stroke:var\(--used\)/,
  );
  assert.match(html, /body:has\(#release-W-10:target\) a\[href="#release-W-10"\] \.mg-flag text\{/);
});
