// The tracker read API, declared project fields, and `hitld work migrate`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { parseArgs } from '../lib/cli/args.mjs';
import { API_VERSION } from '../lib/tracker/files/api.mjs';
import { loadTrackerConfig } from '../lib/tracker/files/config.mjs';
import { renderItem } from '../lib/tracker/files/frontmatter.mjs';
import { lineDiff, planMigrations } from '../lib/tracker/files/migrate.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { git, itemText, makeRepo, policyFor, put } from './tracker-fixture.mjs';

/** @type {import('../lib/tracker/files/config.mjs').DeclaredField[]} */
const FIELDS = [
  { name: 'team', type: 'string', description: 'Owning team.', values: ['core', 'web'] },
  { name: 'points', type: 'integer', description: 'Size in points.' },
  { name: 'labels', type: 'string', list: true, description: 'Labels.' },
];

/** A repo with settings files and the fields declared, item W-4 carrying values. @param {Record<string, string>} [files] */
function repo(files = {}) {
  const root = makeRepo({
    files: {
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'fixture', key: 'W' },
      }),
      '.human-in-the-lead/tracker.json': JSON.stringify({ schema_version: 1, fields: FIELDS }),
      'work/items/W-4-second-step.md': itemText({
        id: 'W-4',
        title: 'Second step',
        kind: 'work',
        status: 'Planned',
        project: 'W-2',
        milestone: 'alpha',
        needs: ['W-3'],
        team: 'core',
        points: '3',
        labels: ['a', 'b'],
      }),
      ...files,
    },
    commit: false,
  });
  for (const f of ['policy.json', 'tracker.json'])
    chmodSync(join(root, '.human-in-the-lead', f), 0o644);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return root;
}

/** @param {string[]} argv @param {string} cwd */
async function hitld(argv, cwd) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: {} });
  return { code, json: JSON.parse(out) };
}

const open = (/** @type {string} */ root) =>
  openTracker({ repoRoot: root, policy: policyFor(), env: {} });

// --- The versioned read API ---------------------------------------------------------------

test('work show --json carries api_version, the entity with typed declared fields, and the declarations', async () => {
  const root = repo();
  const { code, json } = await hitld(['work', 'show', 'W-4', '--json'], root);
  assert.equal(code, 0);
  assert.equal(json.api_version, API_VERSION);
  assert.equal(API_VERSION, 1);
  assert.equal(json.entity.team, 'core');
  assert.equal(json.entity.points, 3);
  assert.deepEqual(json.entity.labels, ['a', 'b']);
  assert.deepEqual(
    json.declared_fields.map((/** @type {any} */ f) => [f.name, f.type, f.list]),
    [
      ['team', 'string', false],
      ['points', 'integer', false],
      ['labels', 'string', true],
    ],
  );
  const plain = await hitld(['work', 'show', 'W-4'], root);
  assert.equal(plain.json.api_version, undefined);
});

test('work query --json carries api_version and leaves bodies out unless asked', async () => {
  const root = repo();
  const { json } = await hitld(['work', 'query', '--json', '--kind', 'work'], root);
  assert.equal(json.api_version, 1);
  assert.equal(json.count, json.entities.length);
  assert.ok(json.entities.every((/** @type {any} */ e) => e.body === undefined));
  const withBodies = await hitld(['work', 'query', '--json', '--bodies'], root);
  assert.ok(withBodies.json.entities.every((/** @type {any} */ e) => typeof e.body === 'string'));
});

test('work query --field matches declared fields, typed, and repeats to narrow', async () => {
  const root = repo();
  const ids = async (/** @type {string[]} */ ...args) =>
    (await hitld(['work', 'query', '--json', ...args], root)).json.entities.map(
      (/** @type {any} */ e) => e.id,
    );
  assert.deepEqual(await ids('--field', 'team=core'), ['W-4']);
  assert.deepEqual(await ids('--field', 'points=3'), ['W-4']);
  assert.deepEqual(await ids('--field', 'labels=b'), ['W-4']);
  assert.deepEqual(await ids('--field', 'team=core', '--field', 'points=4'), []);
  assert.deepEqual(await ids('--field', 'team=web'), []);
  const bad = await hitld(['work', 'query', '--field', 'points=many'], root);
  assert.match(bad.json.message, /points must be a whole number/);
  const unknown = await hitld(['work', 'query', '--field', 'nope=1'], root);
  assert.match(unknown.json.message, /no declared field "nope"/);
  const shape = await hitld(['work', 'query', '--field', 'nope'], root);
  assert.match(shape.json.message, /must be name=value/);
});

test('a repeatable option collects a list', () => {
  const specs = [
    { name: 'field', type: /** @type {const} */ ('string'), description: '', repeatable: true },
  ];
  assert.deepEqual(parseArgs(['--field', 'a=1', '--field=b=2'], specs), { field: ['a=1', 'b=2'] });
});

// --- Declared fields: validation and preservation -------------------------------------------

test('tracker.json refuses a declared field that reuses a format key, is declared twice or has bad values', () => {
  const root = makeRepo();
  /** @param {unknown[]} fields */
  const errors = (fields) => {
    mkdirSync(join(root, '.human-in-the-lead'), { recursive: true });
    writeFileSync(
      join(root, '.human-in-the-lead/tracker.json'),
      JSON.stringify({ schema_version: 1, fields }),
    );
    chmodSync(join(root, '.human-in-the-lead/tracker.json'), 0o644);
    return loadTrackerConfig({ repoRoot: root }).errors.map((e) => `${e.path} ${e.message}`);
  };
  const ok = { name: 'team', type: 'string', description: 'd' };
  assert.deepEqual(errors([ok]), []);
  assert.match(errors([{ ...ok, name: 'status' }])[0], /a key the format already uses/);
  assert.match(errors([{ ...ok, name: 'priority' }])[0], /already uses/);
  assert.match(errors([{ ...ok, name: 'script' }])[0], /already uses/);
  assert.match(errors([{ ...ok, name: 'state' }])[0], /already uses/);
  assert.match(errors([{ ...ok, name: 'owner' }])[0], /already uses/);
  assert.match(errors([ok, ok])[0], /declared twice/);
  assert.match(errors([{ ...ok, name: 'Team' }])[0], /expected form/);
  assert.match(errors([{ ...ok, type: 'date' }])[0], /one of/);
  assert.match(errors([{ ...ok, type: 'integer', values: ['1'] }])[0], /only a string field/);
  assert.match(errors([{ name: 'x', type: 'string' }])[0], /description/);
  assert.match(errors([{ ...ok, extra: true }])[0], /extra/);
});

test('work check validates declared fields against their types and values', () => {
  const root = repo({
    'work/items/W-4-second-step.md': itemText({
      id: 'W-4',
      title: 'Second step',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
      needs: ['W-3'],
      team: 'ops',
      points: 'lots',
      labels: 'single',
    }),
  });
  const { problems } = open(root).check();
  assert.ok(
    problems.some((p) => /"team" must be one of core, web, got "ops"/.test(p)),
    problems.join('\n'),
  );
  assert.ok(problems.some((p) => /"points" must be a whole number, got "lots"/.test(p)));
  assert.ok(problems.some((p) => /"labels" must be a list/.test(p)));
});

test('an undeclared key is still rejected', () => {
  const root = repo({
    'work/items/W-4-second-step.md': itemText({
      id: 'W-4',
      title: 'Second step',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
      needs: ['W-3'],
      stray: 'x',
    }),
  });
  assert.ok(
    open(root)
      .check()
      .problems.some((p) => /"stray" isn't an allowed key/.test(p)),
  );
});

test('the tool keeps declared fields when it rewrites a file, and validates what it writes', () => {
  const root = repo();
  const t = open(root);
  const e = t.get('W-4');
  t.update('W-4', { title: 'Renamed', points: 5 }, String(e.version));
  const after = t.get('W-4');
  assert.equal(after.title, 'Renamed');
  assert.equal(after.points, 5);
  assert.equal(after.team, 'core');
  assert.deepEqual(after.labels, ['a', 'b']);
  const text = readFileSync(join(root, 'work/items/W-4-second-step.md'), 'utf8');
  assert.match(text, /^points: 5$/m);
  assert.match(text, /^labels: \[a, b\]$/m);
  assert.throws(
    () => t.update('W-4', { points: 'x' }, String(after.version)),
    /points must be a whole number/,
  );
  assert.throws(() => t.update('W-4', { team: 'ops' }, String(after.version)), /one of core, web/);
  t.update('W-4', { team: null }, String(after.version));
  assert.equal(t.get('W-4').team, undefined);
});

test('a declared field can be set when an entity is created', () => {
  const root = repo();
  const t = open(root);
  const id = t.create({
    kind: 'work',
    title: 'New one',
    parent: 'W-2',
    team: 'web',
    points: 2,
    labels: ['x'],
  });
  const e = t.get(id);
  assert.deepEqual([e.team, e.points, e.labels], ['web', 2, ['x']]);
  assert.throws(
    () => t.create({ kind: 'work', title: 'Bad', parent: 'W-2', points: 1.5 }),
    /whole number/,
  );
});

// --- hitld work migrate ---------------------------------------------------------------------

/** A fixture migration: every item without `points` gets `points: 1`. @type {import('../lib/tracker/files/migrate.mjs').Migration} */
const addPoints = {
  name: 'default-points',
  summary: 'Give every item a points value of 1 when it has none.',
  plan({ entries }) {
    return entries
      .filter((e) => e.data?.kind === 'work' && e.data.points === undefined)
      .map((e) => ({
        path: e.path,
        text: renderItem({ ...e.data, points: '1' }, Object.keys(e.data ?? {}), e.body),
      }));
  },
};

test('migrate: a dry run shows the diff and writes nothing', () => {
  const root = repo();
  const t = open(root);
  const before = git(root, 'status', '--porcelain');
  const done = t.migrate({ migrations: [addPoints], dryRun: true });
  assert.equal(done.dry_run, true);
  assert.equal(done.changed, 2); // W-3 and W-5 lack points
  const file = done.migrations[0].files.find((f) => f.path.includes('W-3'));
  assert.equal(file?.action, 'change');
  assert.match(file?.diff ?? '', /^\+points: 1$/m);
  assert.equal(git(root, 'status', '--porcelain'), before);
});

test('migrate: applies to the whole tracker in one commit, and is idempotent', () => {
  const root = repo();
  const t = open(root);
  const done = t.migrate({ migrations: [addPoints] });
  assert.equal(done.changed, 2);
  assert.ok(done.commit);
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.match(git(root, 'log', '-1', '--format=%s').trim(), /^migrate: default-points$/);
  assert.equal(git(root, 'show', '--stat', '--format=', 'HEAD').trim().split('\n').length, 3);
  assert.equal(t.get('W-3').points, 1);
  assert.equal(t.get('W-4').points, 3, 'a file already in the new format is left alone');
  const head = git(root, 'rev-parse', 'HEAD');
  const again = t.migrate({ migrations: [addPoints] });
  assert.equal(again.changed, 0);
  assert.equal(again.commit, null);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(open(root).check().problems, []);
});

test('migrate: can create and delete item files, and --only picks a step', () => {
  const root = repo();
  /** @type {import('../lib/tracker/files/migrate.mjs').Migration} */
  const split = {
    name: 'split-decision',
    summary: 'Replace the decision with an external item.',
    plan({ entries }) {
      const d = entries.find((e) => e.data?.kind === 'decision');
      if (!d?.data) return [];
      return [
        { path: d.path, text: null },
        {
          path: 'work/items/W-7-waiting.md',
          text: itemText({
            id: 'W-7',
            title: 'Waiting',
            kind: 'external',
            status: 'Planned',
            project: 'W-2',
            party: 'vendor',
          }),
        },
      ];
    },
  };
  const t = open(root);
  // W-5 needs W-6 (the decision), so the plain result would fail the check: refused, nothing written.
  assert.throws(
    () => t.migrate({ migrations: [split], only: 'split-decision' }),
    /would fail the check/,
  );
  assert.throws(
    () => t.migrate({ migrations: [addPoints], only: 'nope' }),
    /no migration named "nope"/,
  );
  put(root, {
    'work/items/W-5-third-step.md': itemText({
      id: 'W-5',
      title: 'Third step',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
      needs: ['W-4'],
    }),
  });
  git(root, 'commit', '-qam', 'drop the need');
  const done = t.migrate({ migrations: [addPoints, split], only: 'split-decision' });
  assert.deepEqual(
    done.migrations.map((s) => s.name),
    ['split-decision'],
  );
  assert.deepEqual(done.migrations[0].files.map((f) => f.action).sort(), ['create', 'delete']);
  assert.equal(t.get('W-7').kind, 'external');
  assert.throws(() => t.get('W-6'), /not in the tracker/);
});

test('migrate: refuses a step that is not idempotent or names a file outside the item folders', () => {
  const root = repo();
  const t = open(root);
  let n = 0;
  /** @type {import('../lib/tracker/files/migrate.mjs').Migration} */
  const never = {
    name: 'never-settles',
    summary: 'Changes the first file on every plan.',
    plan: ({ entries }) =>
      entries.slice(0, 1).map((e) => ({
        path: e.path,
        text: renderItem(e.data ?? {}, [], `${e.body}${n++}\n`),
      })),
  };
  assert.throws(() => t.migrate({ migrations: [never], dryRun: true }), /not idempotent/);
  /** @type {import('../lib/tracker/files/migrate.mjs').Migration} */
  const escape = {
    name: 'escape',
    summary: 'Writes outside.',
    plan: () => [{ path: '../x.md', text: 'x' }],
  };
  assert.throws(() => t.migrate({ migrations: [escape], dryRun: true }), /not an item file/);
  assert.throws(
    () => t.migrate({ migrations: [addPoints, addPoints], dryRun: true }),
    /registered twice/,
  );
});

test('migrate: only the orchestrator applies one, and not over uncommitted changes', () => {
  const root = repo();
  assert.throws(
    () =>
      openTracker({ repoRoot: root, policy: policyFor(), env: { HITLD_ROLE: 'executor' } }).migrate(
        { migrations: [addPoints] },
      ),
    /only the orchestrator/,
  );
  put(root, {
    'work/items/W-6-which-way.md': itemText({
      id: 'W-6',
      title: 'Which way?',
      kind: 'decision',
      status: 'Planned',
      project: 'W-2',
      'decided-by': 'owner',
      priority: 'low',
    }),
  });
  assert.throws(() => open(root).migrate({ migrations: [addPoints] }), /uncommitted changes/);
  const done = open(root).migrate({ migrations: [addPoints], commit: false });
  assert.equal(done.commit, null);
  assert.equal(open(root).get('W-3').points, 1);
});

test('work check names files a registered migration still needs', () => {
  // The registry is empty today, so the check adds nothing; the library function reports pending files.
  const root = repo();
  assert.deepEqual(open(root).check().problems, []);
  const plan = planMigrations(root, open(root).layout(), { migrations: [addPoints] });
  assert.equal(plan.steps[0].files.length, 2);
});

test('work migrate with nothing registered changes nothing', async () => {
  const root = repo();
  const out = await hitld(['work', 'migrate', '--dry-run'], root);
  assert.equal(out.code, 0);
  assert.equal(out.json.changed, 0);
  assert.deepEqual(out.json.registered, []);
  assert.equal(out.json.summary, 'nothing to migrate');
  const real = await hitld(['work', 'migrate'], root);
  assert.equal(real.code, 0);
  assert.equal(real.json.commit, null);
  const unknown = await hitld(['work', 'migrate', '--only', 'x'], root);
  assert.equal(unknown.code, 1);
  assert.match(unknown.json.message, /no migration named "x"/);
});

test('lineDiff marks changed lines with context and gaps', () => {
  const a = ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n');
  const b = ['1', '2', 'three', '4', '5', '6', '7', 'eight'].join('\n');
  assert.equal(
    lineDiff(a, b),
    [' 2', '-3', '+three', ' 4', '...', ' 7', '-8', '+eight'].join('\n'),
  );
  assert.equal(lineDiff(null, 'x'), '+x');
  assert.equal(lineDiff('x', null), '-x');
});
