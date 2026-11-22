// The link between an item and a milestone clause lives on the item (HITLD-767, decided in
// HITLD-784 and HITLD-785): an item's `constraint_of`, a milestone's constraints derived from its
// items, the check, the retired milestone-side line read until rc.3 (the item side wins), the
// migration constraints-on-items, and two branches that each file an item into one milestone
// merging without a conflict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { constraintsOnItems } from '../lib/tracker/files/migrations/constraints-on-items.mjs';
import {
  commitAll,
  git,
  isolatedEnv,
  itemText,
  makeRepo,
  policyFor,
  put,
} from './tracker-fixture.mjs';

const HOME = isolatedEnv();

const open = (/** @type {string} */ root, env = {}) =>
  openTracker({ repoRoot: root, policy: policyFor(), env: { ...HOME, ...env } });

/** @param {string[]} argv @param {string} cwd @param {Record<string, string>} [env] */
async function hitld(argv, cwd, env = {}) {
  let out = '';
  const code = await main(argv, {
    out: (t) => (out += t),
    err: () => {},
    cwd,
    env: { ...HOME, ...env },
  });
  return { code, json: JSON.parse(out) };
}

/** A policy file, for the command line. @param {string} root */
function settings(root) {
  put(root, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
    }),
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAll(root, 'settings');
}

const M7 = 'work/milestones/W-7-config-errors-explained.md';
const W4 = 'work/items/W-4-second-step.md';
const W5 = 'work/items/W-5-third-step.md';

/** The milestone W-7 under W-2, with two clauses. @param {Record<string, string | string[]>} [extra] */
const milestone = (extra = {}) =>
  itemText({
    id: 'W-7',
    title: 'Config errors explained',
    kind: 'milestone',
    state: 'planned',
    project: 'W-2',
    outcome: 'A user with a bad config sees which key is wrong.',
    done_when: ['"c1: An unknown key exits with status 2."', '"c2: The message names the line."'],
    check: 'demo run a bad config',
    ...extra,
  });

/** @param {string} id @param {string} title @param {Record<string, string | string[]>} [extra] */
const work = (id, title, extra = {}) =>
  itemText({ id, title, kind: 'work', state: 'planned', project: 'W-2', ...extra });

const read = (/** @type {string} */ root, /** @type {string} */ p) =>
  readFileSync(join(root, p), 'utf8');

test("a milestone's constraints are derived from its items' constraint_of", () => {
  const root = makeRepo({
    files: {
      [M7]: milestone(),
      [W4]: work('W-4', 'Second step', { needs: ['W-3'], constraint_of: ['W-7 c1'] }),
      [W5]: work('W-5', 'Third step', { constraint_of: ['W-7 c2', 'W-1 c?'] }),
    },
  });
  const t = open(root);
  const check = t.check();
  assert.deepEqual(check.problems, []);
  assert.equal(
    check.warnings.some((w) => w.includes('retired')),
    false,
  );
  const m = t.get('W-7');
  assert.deepEqual(m.constraints, [
    { id: 'W-4', clause: 'c1' },
    { id: 'W-5', clause: 'c2' },
  ]);
  // Clause coverage comes from the items: each clause's open constraints.
  assert.deepEqual(
    /** @type {any[]} */ (m.unmet_clauses).map((u) => [u.clause, u.open]),
    [
      ['c1', ['W-4']],
      ['c2', ['W-5']],
    ],
  );
  assert.deepEqual(t.get('W-5').constraint_of, ['W-1', 'W-7']);
  assert.deepEqual(t.get('W-1').constraints, [{ id: 'W-5', clause: null }]);
  assert.deepEqual(/** @type {string[]} */ (t.get('W-1').to_shape).at(-1), 'link W-5 to a clause');
});

test('the check refuses a constraint_of that names no milestone or no clause it has', () => {
  const root = makeRepo({
    files: {
      [M7]: milestone(),
      [W4]: work('W-4', 'Second step', {
        constraint_of: ['W-7 c9', 'W-99 c1', 'W-6 c1', 'W-7', 'W-7 c1', 'W-7 c1'],
      }),
    },
  });
  const problems = open(root)
    .check()
    .problems.filter((p) => p.startsWith(`${W4}: `));
  assert.deepEqual(problems, [
    `${W4}: constraint_of W-7 c9: W-7 has no clause c9 in done_when`,
    `${W4}: constraint_of W-99 c1: W-99 doesn't exist`,
    `${W4}: constraint_of W-6 c1: W-6 is a decision, not a milestone`,
    `${W4}: constraint_of: "W-7" isn't "<milestone ID> c<n>" or "<milestone ID> c?"`,
    `${W4}: constraint_of W-7 c1 appears twice`,
  ]);
  assert.throws(
    () => {
      const t = open(root);
      const version = String(t.get('W-5').version);
      t.update('W-5', /** @type {any} */ ({ constraint_of: ['W-7 c3'] }), version);
    },
    /W-7 has no clause c3/,
    'a change that would add such a link is refused',
  );
});

test('until migrated, the milestone line is read too, the item side wins, and the check warns', () => {
  const root = makeRepo({
    files: {
      [M7]: milestone({ constraints: ['W-4 c1', 'W-5 c1'] }),
      [W4]: work('W-4', 'Second step', { needs: ['W-3'] }),
      // W-5 names W-7 itself, under c2: its own link wins over the line's c1.
      [W5]: work('W-5', 'Third step', { constraint_of: ['W-7 c2'] }),
    },
  });
  const t = open(root);
  const check = t.check();
  assert.deepEqual(check.problems, [], 'the old form is a warning, not a problem');
  assert.deepEqual(
    check.warnings.filter((w) => w.includes('retired')),
    [
      `${M7}: its constraints line is retired (HITLD-767): each item names the clause it serves as constraint_of; run hitld work migrate constraints-on-items (the line is read until rc.3, and an item's own constraint_of wins)`,
    ],
  );
  assert.deepEqual(t.get('W-7').constraints, [
    { id: 'W-4', clause: 'c1' },
    { id: 'W-5', clause: 'c2' },
  ]);
  assert.deepEqual(t.get('W-4').constraint_of, ['W-7']);
});

test('migrate constraints-on-items moves every link into its item, drops the line, and is idempotent', async () => {
  const root = makeRepo({
    files: {
      [M7]: milestone({ constraints: ['W-4 c1', 'W-5 c1', 'W-6 c2'] }),
      'work/milestones/W-8-faster-start.md': itemText({
        id: 'W-8',
        title: 'Faster start',
        kind: 'milestone',
        state: 'planned',
        project: 'W-2',
        done_when: ['"c1: It starts in a second."'],
        constraints: ['W-4 c1', 'W-77 c1'],
      }),
      'work/milestones/W-1-goal.md': itemText({
        id: 'W-1',
        title: 'The goal',
        kind: 'milestone',
        state: 'planned',
        owner: 'owner',
        constraints: ['W-7 c?', 'W-8 c?'],
      }),
      [W4]: work('W-4', 'Second step', { needs: ['W-3'] }),
      [W5]: work('W-5', 'Third step', { needs: ['W-4', 'W-6'], constraint_of: ['W-7 c2'] }),
    },
  });
  settings(root);
  const before = open(root);
  const derived = (/** @type {ReturnType<typeof open>} */ t) =>
    ['W-1', 'W-7', 'W-8'].map((id) => t.get(id).constraints);
  const was = derived(before);
  // W-77 does not exist: the check names it before and after, and it stays on W-8's line.
  const problems = before.check().problems;
  assert.deepEqual(problems, [
    "work/milestones/W-8-faster-start.md: needs W-77, which doesn't exist",
  ]);

  const executor = await hitld(['work', 'migrate', 'constraints-on-items'], root, {
    HITLD_ROLE: 'executor',
  });
  assert.equal(executor.code, 1);
  assert.equal(executor.json.error, 'not-permitted', 'only the orchestrator migrates');

  const dry = await hitld(['work', 'migrate', 'constraints-on-items', '--dry-run'], root);
  assert.equal(dry.code, 0, JSON.stringify(dry.json));
  assert.deepEqual(
    dry.json.migrations.map((/** @type {any} */ s) => s.name),
    ['constraints-on-items'],
  );
  const done = await hitld(['work', 'migrate', 'constraints-on-items'], root);
  assert.equal(done.code, 0, JSON.stringify(done.json));
  assert.match(git(root, 'log', '-1', '--format=%s').trim(), /^migrate: constraints-on-items$/);
  assert.equal(git(root, 'status', '--porcelain'), '');

  assert.equal(read(root, M7).includes('constraints:'), false);
  assert.equal(read(root, 'work/milestones/W-1-goal.md').includes('constraints:'), false);
  assert.match(read(root, 'work/milestones/W-8-faster-start.md'), /\nconstraints: \[W-77 c1\]\n/);
  assert.equal(
    read(root, W4),
    itemText({
      id: 'W-4',
      title: 'Second step',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      needs: ['W-3'],
      constraint_of: ['W-7 c1', 'W-8 c1'],
    }),
    'only the new line, in key order',
  );
  assert.match(read(root, W5), /\nconstraint_of: \[W-7 c2\]\n/, 'its own link won; nothing added');
  assert.match(read(root, 'work/items/W-6-which-way.md'), /\nconstraint_of: \[W-7 c2\]\n/);
  assert.match(
    read(root, M7),
    /\nconstraint_of: \[W-1 c\?\]\n/,
    'a milestone serves a long outcome',
  );

  const after = open(root);
  assert.deepEqual(derived(after), was, 'every milestone derives the same constraints');
  assert.deepEqual(after.check().problems, problems);
  assert.deepEqual(
    after.check().warnings.filter((w) => w.includes('retired')),
    [
      "work/milestones/W-8-faster-start.md: its constraints line is retired (HITLD-767): each item names the clause it serves as constraint_of; run hitld work migrate constraints-on-items (the line is read until rc.3, and an item's own constraint_of wins)",
    ],
    'only the line that names nothing is left',
  );
  const head = git(root, 'rev-parse', 'HEAD');
  const again = await hitld(['work', 'migrate', 'constraints-on-items'], root);
  assert.equal(again.json.changed, 0, 'a second run changes nothing');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(constraintsOnItems.warns, true);
});

test('two branches that each file an item into the same milestone merge without a conflict', () => {
  const root = makeRepo({
    files: {
      [M7]: milestone(),
      [W4]: work('W-4', 'Second step', { needs: ['W-3'], constraint_of: ['W-7 c1'] }),
    },
  });
  git(root, 'checkout', '-q', '-b', 'one');
  put(root, {
    'work/items/W-10-explain-keys.md': work('W-10', 'Explain keys', { constraint_of: ['W-7 c1'] }),
  });
  commitAll(root, 'file W-10 into W-7 c1');
  git(root, 'checkout', '-q', 'main');
  git(root, 'checkout', '-q', '-b', 'two');
  put(root, {
    'work/items/W-11-name-the-line.md': work('W-11', 'Name the line', {
      constraint_of: ['W-7 c2'],
    }),
  });
  commitAll(root, 'file W-11 into W-7 c2');
  git(root, 'checkout', '-q', 'main');
  git(root, 'merge', '-q', '--no-edit', 'one');
  // The second merge is a true three-way merge, and neither branch touched the milestone file.
  git(root, 'merge', '-q', '--no-edit', 'two');
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(git(root, 'diff', '--name-only', 'main~1', 'main', '--', M7), '');
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.deepEqual(t.get('W-7').constraints, [
    { id: 'W-4', clause: 'c1' },
    { id: 'W-10', clause: 'c1' },
    { id: 'W-11', clause: 'c2' },
  ]);
});
