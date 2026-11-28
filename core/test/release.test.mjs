// Releases (design parts 2.7, 3.2 and 16.5): versions, the interface surface and its delta, the
// proposed bump, release records, and `hitld release propose` and `make`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../lib/cli/main.mjs';
import { commands as releaseCommands } from '../lib/cli/commands/release.mjs';
import { diffSurface, emptySurface, proposeBump } from '../lib/release/delta.mjs';
import {
  contractShape,
  schemaFields,
  surfaceFileText,
  surfaceOf,
} from '../lib/release/surface.mjs';
import {
  bumpBetween,
  bumpVersion,
  compareVersions,
  isPrerelease,
  nextPrerelease,
} from '../lib/release/semver.mjs';
import { proposeRelease } from '../lib/release/propose.mjs';
import { checkReleaseCommit } from '../lib/release/check.mjs';
import { withoutClosingReferences } from '../lib/release/make.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { loadPolicy } from '../lib/policy/policy.mjs';
import { commitAll, git, itemText, makeRepo, put } from './tracker-fixture.mjs';
import { removeAtExit, tempDir } from './helpers/tmp.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The tracker of a fixture, under the fixture's own policy.json. @param {string} root */
const open = (root, env = {}) =>
  openTracker({
    repoRoot: root,
    policy: /** @type {any} */ (loadPolicy({ cwd: root }).policy),
    env,
  });

/** The fixture's one release package: main, tagged v<version>, measured from surface.txt. */
const MAIN = {
  name: 'main',
  tag: 'v{version}',
  paths: ['**'],
  surface: 'surface.txt',
  version_source: 'package.json',
};
/** The fixture's first surface file. */
const SURFACE =
  'schema thing\nschema thing id: string, required\nschema thing name: string, optional\n';

/** @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} [env] */
async function hitld(argv, cwd, env = {}) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, json: JSON.parse(out) };
}

/** A schema with the given properties. @param {Record<string, unknown>} properties */
const schema = (properties, required = ['id']) =>
  JSON.stringify({
    $id: 'thing',
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });

/**
 * A fixture repository with settings declaring one release package, main, and its committed
 * surface file.
 */
function releaseRepo(/** @type {Record<string, string>} */ extra = {}) {
  const root = makeRepo({
    files: {
      ...extra,
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'fixture', key: 'W' },
        release: { packages: [MAIN] },
      }),
      'surface.txt': SURFACE,
      'package.json': '{ "version": "0.0.0" }\n',
    },
    commit: false,
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAll(root, 'fixture');
  return root;
}

// --- Versions ------------------------------------------------------------------------------

test('versions order as semver does, pre-releases first', () => {
  const sorted = ['1.0.0', '0.1.0', '0.1.0-rc.10', '0.1.0-rc.2', '0.1.0-beta.1', '0.2.0'].sort(
    compareVersions,
  );
  assert.deepEqual(sorted, [
    '0.1.0-beta.1',
    '0.1.0-rc.2',
    '0.1.0-rc.10',
    '0.1.0',
    '0.2.0',
    '1.0.0',
  ]);
  assert.equal(bumpVersion('0.1.0', 'minor'), '0.2.0');
  assert.equal(bumpVersion('1.4.2', 'major'), '2.0.0');
  assert.equal(bumpVersion('0.0.0', 'minor'), '0.1.0');
  assert.equal(bumpBetween('0.1.0', '0.1.1'), 'patch');
  assert.equal(bumpBetween('0.0.0', '0.1.0-rc.1'), 'minor');
  assert.equal(bumpBetween('0.1.0', '0.1.0'), null);
  assert.equal(isPrerelease('0.1.0-rc.1'), true);
  assert.equal(
    nextPrerelease('0.1.0', 'rc', ['0.1.0-rc.1', '0.1.0-rc.2', '0.0.9-rc.7', '0.1.0-beta.4']),
    '0.1.0-rc.3',
  );
  assert.equal(nextPrerelease('0.1.0', 'beta', ['0.1.0-rc.1', '0.1.0-rc.2']), '0.1.0-beta.1');
  assert.equal(nextPrerelease('0.1.0', 'rc', []), '0.1.0-rc.1');
  assert.throws(() => nextPrerelease('0.1.0', 'RC1', []), /lower-case letters/);
});

// --- The surface and its delta --------------------------------------------------------------

test('the surface reads schemas, built commands, the report shape, trailers and the read API', async () => {
  const s = await surfaceOf(ROOT);
  assert.equal(s.read_api, 3);
  assert.deepEqual(s.report, [
    'item',
    'result',
    'commit',
    'evidence',
    'bench_runs',
    'deviations',
    'calls',
    'questions',
  ]);
  assert.deepEqual(s.trailers, [
    'Work-Item',
    'Dispatch',
    'Agent-Role',
    'Agent-Model',
    'Agent-Effort',
  ]);
  assert.ok(s.schemas.milestone.fields['constraints[].clause']);
  assert.ok(s.schemas.release.fields.interface_delta);
  assert.deepEqual(s.cli['release propose'].output?.includes('interface_delta'), true);
  assert.equal(s.cli['mcp'], undefined, 'a command not yet built is not surface');
  const c = contractShape('a\n```\nitem: x\nstatus: y\n```\nCommit trailers: `Work-Item:`.\n');
  assert.deepEqual([c.report, c.trailers], [['item', 'status'], ['Work-Item']]);
  const fields = schemaFields(JSON.parse(schema({ id: { type: 'string' } })));
  assert.deepEqual(fields, { id: { type: 'string', required: true } });
});

test('the surface file lists the interface one element per line, sorted; the committed file is current', async () => {
  const text = await surfaceFileText(ROOT);
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, [...lines].sort());
  assert.ok(lines.includes('cli hitld release propose --package: string, optional'));
  assert.ok(lines.includes('cli hitld release propose json dependents'));
  assert.ok(lines.includes('report bench_runs'));
  assert.ok(lines.includes('trailer Work-Item'));
  assert.ok(lines.includes('read-api version 3'));
  assert.ok(lines.some((l) => l.startsWith('schema release package: string, optional')));
  assert.equal(
    lines.some((l) => l.startsWith('contract')),
    false,
    'the contract prose is not interface',
  );
  // Once this repository's package declares the file (hitld release migrate --surface), it must
  // be written again with every change to the interface: npm run surface.
  const loaded = loadPolicy({ cwd: ROOT }).policy;
  for (const p of loaded?.release?.packages ?? []) {
    if (p.surface !== 'release/surface.txt') continue;
    assert.equal(
      readFileSync(join(ROOT, p.surface), 'utf8'),
      text,
      'release/surface.txt is stale: run npm run surface and commit it',
    );
  }
});

/** A surface with one schema and one command. @param {Partial<import('../lib/release/surface.mjs').Surface>} [over] */
function surface(over = {}) {
  return {
    ...emptySurface(),
    schemas: {
      item: {
        version: 1,
        fields: {
          id: { type: 'string', required: true },
          state: { type: 'enum', required: true, values: ['planned', 'done'] },
        },
      },
    },
    cli: {
      'work show': {
        args: { id: { type: 'string', required: true, positional: true } },
        aliases: [],
        output: ['api_version', 'entity', 'ok'],
      },
    },
    report: ['item', 'status'],
    trailers: ['Work-Item'],
    contract: 'aaa',
    read_api: 1,
    ...over,
  };
}

test('the delta marks each change breaking, additive or fix', () => {
  const base = surface();
  assert.deepEqual(diffSurface(base, surface()), []);
  const next = surface({
    schemas: {
      item: {
        version: 2,
        fields: {
          id: { type: 'integer', required: true },
          state: { type: 'enum', required: true, values: ['planned', 'dropped'] },
          note: { type: 'string', required: false },
        },
      },
      release: { version: 1, fields: {} },
    },
    cli: {
      'work show': {
        args: {
          id: { type: 'string', required: true, positional: true },
          json: { type: 'boolean', required: false, positional: false },
        },
        aliases: [],
        output: ['entity', 'ok'],
      },
    },
    report: ['item', 'status', 'runs'],
    trailers: [],
    contract: 'bbb',
    read_api: 2,
  });
  assert.deepEqual(diffSurface(base, next), [
    { impact: 'breaking', surface: 'schemas', what: 'item: id type string → integer' },
    { impact: 'additive', surface: 'schemas', what: 'item: note added' },
    { impact: 'breaking', surface: 'schemas', what: 'item: state no longer allows done' },
    { impact: 'additive', surface: 'schemas', what: 'item: state allows dropped' },
    { impact: 'additive', surface: 'schemas', what: 'schema release added' },
    { impact: 'additive', surface: 'cli', what: 'hitld work show --json added' },
    { impact: 'breaking', surface: 'cli', what: 'hitld work show JSON: api_version removed' },
    { impact: 'additive', surface: 'report', what: 'report key runs added' },
    { impact: 'breaking', surface: 'trailers', what: 'trailer Work-Item removed' },
    { impact: 'fix', surface: 'contract', what: "the executor contract's wording changed" },
    { impact: 'breaking', surface: 'read-api', what: 'api_version 1 → 2' },
  ]);
});

test('the bump comes from the delta alone: breaking is major, or minor under 0.y.z, flagged', () => {
  const additive = diffSurface(surface(), surface({ report: ['item', 'status', 'runs'] }));
  assert.deepEqual(proposeBump(additive, '0.3.1'), {
    bump: 'minor',
    breaking: false,
    version: '0.4.0',
    reason: '1 additive change(s), none breaking: minor',
  });
  const removed = diffSurface(surface(), surface({ report: ['item'] }));
  assert.equal(proposeBump(removed, '1.2.0').bump, 'major');
  assert.equal(proposeBump(removed, '1.2.0').version, '2.0.0');
  assert.deepEqual(proposeBump(removed, '0.3.1'), {
    bump: 'minor',
    breaking: true,
    version: '0.4.0',
    reason: '1 breaking change(s): minor while the version is 0.y.z, flagged breaking',
  });
  assert.equal(proposeBump([], '0.3.1').bump, 'patch');
  assert.match(proposeBump([], '0.3.1').reason, /internal change proposes patch at most/);
  assert.throws(() => proposeBump([], '0.3.1-rc.1'), /not a full release/);
});

// --- propose and make ------------------------------------------------------------------------

test('with no tag yet, propose says so and treats the whole surface as initial', async () => {
  const root = releaseRepo();
  const p = await hitld(['release', 'propose', '--json'], root);
  assert.equal(p.code, 0, JSON.stringify(p.json));
  assert.equal(p.json.last_tag, null);
  assert.equal(p.json.base, null);
  assert.equal(p.json.first_release, true);
  assert.equal(p.json.version, '0.1.0');
  assert.equal(p.json.tag, 'v0.1.0');
  assert.equal(p.json.package, 'main');
  assert.equal(p.json.surface, 'surface.txt');
  assert.equal(p.json.interface_measured, true);
  assert.match(p.json.reason, /^no release of main yet, so its whole surface is new/);
  assert.deepEqual(p.json.interface_delta, [
    { impact: 'additive', surface: 'surface', what: 'surface.txt: added schema thing' },
    {
      impact: 'additive',
      surface: 'surface',
      what: 'surface.txt: added schema thing id: string, required',
    },
    {
      impact: 'additive',
      surface: 'surface',
      what: 'surface.txt: added schema thing name: string, optional',
    },
  ]);
  assert.deepEqual(p.json.items, ['W-3']);
  assert.deepEqual(p.json.warnings, [
    'package.json says 0.0.0; set it to 0.1.0 before main is released',
  ]);
  assert.equal(p.json.releases.length, 1);
  assert.equal(p.json.releases[0].tag, 'v0.1.0');
  const rc = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(rc.json.version, '0.1.0-rc.1');
  assert.equal(rc.json.prerelease, true);
  assert.match(rc.json.prerelease_rule, /never the base/);
});

test('release make refuses outside the owner’s own turn', async () => {
  const root = releaseRepo();
  const executor = await hitld(['release', 'make'], root, { HITLD_ROLE: 'executor' });
  assert.equal(executor.code, 1);
  assert.equal(executor.json.error, 'not-permitted');
  assert.match(executor.json.message, /owner's, through the main session/);
  const dispatched = await hitld(['release', 'make'], root, { HITLD_DISPATCH: 'D-4' });
  assert.equal(dispatched.json.error, 'not-permitted');
  const make = releaseCommands.find((c) => c.name === 'release make');
  assert.equal(make?.mcp, false);
  const viaTool = await make?.run?.({}, { cwd: root, env: {} });
  assert.equal(viaTool?.error, 'not-permitted');
  assert.match(String(viaTool?.message), /not the human command line/);
  const side = removeAtExit(join(root, '..', `wt-${Date.now()}`));
  git(root, 'worktree', 'add', '-q', '-b', 'side', side);
  const wt = git(root, 'worktree', 'list', '--porcelain').match(/^worktree (.*wt-\d+)$/m)?.[1];
  const linked = await hitld(['release', 'make'], String(wt));
  assert.match(linked.json.message, /linked worktree/);
  assert.equal(git(root, 'tag', '--list').trim(), '', 'nothing was tagged');
});

test('release make writes the record and the tag, never pushes, and the record is read back', async () => {
  const root = releaseRepo();
  const remote = tempDir('hitld-remote-');
  git(remote, 'init', '-q', '--bare');
  git(root, 'remote', 'add', 'origin', remote);

  const low = await hitld(['release', 'make', '--version', '0.0.1'], root);
  assert.equal(low.code, 1);
  assert.match(
    low.json.message,
    /0\.0\.1 is a patch release, but the interface delta proposes minor/,
  );

  const rc = await hitld(['release', 'make', '--pre', 'rc'], root);
  assert.equal(rc.code, 0, JSON.stringify(rc.json));
  assert.equal(rc.json.tag, 'v0.1.0-rc.1');
  assert.equal(rc.json.prerelease, true);
  assert.equal(rc.json.pushed, false);
  assert.match(rc.json.next, /Nothing was pushed/);
  assert.equal(git(root, 'tag', '--list').trim(), 'v0.1.0-rc.1');
  assert.equal(git(root, 'cat-file', '-t', 'v0.1.0-rc.1').trim(), 'tag', 'an annotated tag');
  assert.equal(git(root, 'log', '-1', '--format=%s').trim(), 'release record: v0.1.0-rc.1');
  assert.match(
    git(root, 'log', '-1', '--format=%B'),
    /^Signed-off-by: Fixture <fixture@example\.invalid>$/m,
    'signed off by the person who ran it (DCO)',
  );
  assert.equal(git(remote, 'tag', '--list').trim(), '', 'never pushed');
  const record = readFileSync(join(root, 'work/releases/main/0.1.0-rc.1.md'), 'utf8');
  assert.match(
    record,
    /^---\nid: v0\.1\.0-rc\.1\npackage: main\nversion: 0\.1\.0-rc\.1\nbump: minor\ninterface_delta: \[/,
  );
  assert.match(record, /\ndecision: owner\nitems: \[W-3\]\nclassification: public\n---\n/);
  let t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.equal(t.get('W-3').released_in, null, 'a pre-release does not set released_in');

  const next = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(next.json.last_tag, 'v0.1.0-rc.1');
  assert.equal(next.json.base, null, 'a pre-release is never the base');
  assert.equal(next.json.version, '0.1.0-rc.2');

  const full = await hitld(['release', 'make', '--decision', 'W-6'], root);
  assert.equal(full.code, 0, JSON.stringify(full.json));
  assert.equal(full.json.tag, 'v0.1.0');
  t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.equal(t.get('W-3').released_in, 'v0.1.0');
  const shown = await hitld(['work', 'show', 'v0.1.0', '--json'], root);
  assert.equal(shown.json.api_version, 3);
  assert.equal(shown.json.entity.kind, 'release');
  assert.equal(shown.json.entity.decision, 'W-6');
  assert.equal(shown.json.entity.prerelease, false);
  assert.deepEqual(shown.json.entity.interface_delta[0], {
    impact: 'additive',
    surface: 'surface',
    what: 'surface.txt: added schema thing',
  });
  assert.equal(shown.json.entity.package, 'main');
  const listed = await hitld(['work', 'query', '--kind', 'release', '--json'], root);
  assert.deepEqual(listed.json.entities.map((/** @type {any} */ e) => e.id).sort(), [
    'v0.1.0',
    'v0.1.0-rc.1',
  ]);
  assert.match(t.renderViewTexts().unreleased, /^\n0 merged item\(s\) not in a release\n$/);
  const again = await hitld(['release', 'make', '--version', '0.1.0'], root);
  assert.match(again.json.message, /not above the last full release, 0\.1\.0/);
});

test('after a release, the delta is the surface file between the last full release and now', async () => {
  const root = releaseRepo();
  assert.equal((await hitld(['release', 'make'], root)).code, 0);
  put(root, { 'surface.txt': `${SURFACE}schema thing note: string, optional\n` });
  commitAll(root, 'an optional field');
  const additive = await hitld(['release', 'propose'], root);
  assert.equal(additive.json.base, 'v0.1.0');
  assert.deepEqual(additive.json.interface_delta, [
    {
      impact: 'additive',
      surface: 'surface',
      what: 'surface.txt: added schema thing note: string, optional',
    },
  ]);
  assert.equal(additive.json.version, '0.2.0');
  // A changed line is a removed line and an added one: breaking.
  put(root, { 'surface.txt': SURFACE.replace('name: string, optional', 'name: string, required') });
  commitAll(root, 'make a field required');
  const breaking = await hitld(['release', 'propose'], root);
  assert.equal(breaking.json.bump, 'minor', 'minor while 0.y.z');
  assert.equal(breaking.json.breaking, true);
  assert.deepEqual(
    breaking.json.interface_delta.map((/** @type {any} */ e) => [e.impact, e.what]),
    [
      ['breaking', 'surface.txt: removed schema thing name: string, optional'],
      ['additive', 'surface.txt: added schema thing name: string, required'],
    ],
  );
  // Blank lines, comments and order do not count.
  put(root, {
    'surface.txt': `# a comment\n\n${SURFACE.split('\n').reverse().join('\n')}\n`,
    'src/x.js': 'x\n',
  });
  commitAll(root, 'internal only');
  const internal = await hitld(['release', 'propose'], root);
  assert.deepEqual(internal.json.interface_delta, []);
  assert.equal(internal.json.bump, 'patch');
  assert.equal(internal.json.version, '0.1.1');
});

test('propose lists unmet gates, missing release_note lines and drafts notes; make waits for gates', async () => {
  const root = makeRepo({
    files: {
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'fixture', key: 'W' },
        release: { packages: [MAIN] },
      }),
      'surface.txt': SURFACE,
      '.human-in-the-lead/tracker.json': JSON.stringify({
        schema_version: 1,
        optional_keys: ['release_note'],
      }),
      'work/milestones/W-7-ready.md': itemText({
        id: 'W-7',
        title: 'Ready',
        kind: 'milestone',
        state: 'planned',
        project: 'W-2',
        constraints: ['W-3 c?'],
      }),
      'work/items/W-8-release.md': itemText({
        id: 'W-8',
        title: 'Release',
        kind: 'work',
        state: 'planned',
        project: 'W-2',
        needs: ['W-7'],
      }),
      'work/items/W-9-shipped.md': itemText({
        id: 'W-9',
        title: 'Shipped',
        kind: 'work',
        state: 'done',
        project: 'W-2',
        release_note: 'Config errors name the key.',
      }),
    },
    commit: false,
  });
  for (const f of ['policy.json', 'tracker.json'])
    chmodSync(join(root, '.human-in-the-lead', f), 0o644);
  commitAll(root, 'fixture');
  put(root, { 'surface.txt': 'schema thing\n' });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'a schema', '-m', 'Work-Item: W-3');
  const t = open(root);
  const p = await proposeRelease(t, {});
  assert.deepEqual(p.gates, [
    {
      item: 'W-8',
      id: 'W-7',
      kind: 'milestone',
      title: 'Ready',
      state: 'planned',
      check_due: true,
    },
  ]);
  assert.deepEqual(p.notes, ['Config errors name the key. (W-9)']);
  assert.deepEqual(p.missing_release_note, [{ item: 'W-3', files: ['surface.txt'] }]);
  const refused = await hitld(['release', 'make', '--item', 'W-8'], root);
  assert.equal(refused.code, 1);
  assert.match(
    refused.json.message,
    /the release waits for its gates: W-7 Ready \(planned, check due\)/,
  );
});

// --- Issues an item comes from close when its release ships (HITLD-1015) ----------------------

test('propose and make list the issues of the items a release ships first; an earlier pre-release keeps its own', async () => {
  /** @param {string} id @param {string} state @param {Record<string, unknown>} more */
  const item = (id, state, more = {}) => ({
    [`work/items/${id}-from-issue.md`]: itemText({
      id,
      title: `From an issue ${id}`,
      kind: 'work',
      state,
      project: 'W-2',
      touches: ['src/**'],
      ...more,
    }),
  });
  const root = releaseRepo({
    ...item('W-9', 'done', { source_issue: 604 }),
    ...item('W-10', 'done', { source_issue: 603 }),
    ...item('W-11', 'done'),
    ...item('W-12', 'planned', { source_issue: 605 }),
  });
  // source_issue is always on: the fixture's tracker turns on no optional key.
  assert.deepEqual(open(root).check().problems, []);

  const p = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(p.code, 0, JSON.stringify(p.json));
  assert.deepEqual(p.json.issues, [
    { issue: 603, item: 'W-10' },
    { issue: 604, item: 'W-9' },
  ]);
  assert.deepEqual(p.json.releases[0].issues, p.json.issues);

  const branch = await hitld(['release', 'make', '--pre', 'rc', '--branch', 'release'], root);
  assert.equal(branch.code, 0, JSON.stringify(branch.json));
  assert.deepEqual(branch.json.issues, p.json.issues);
  assert.match(
    branch.json.pr.body,
    /## Issues to close when it ships\n\n- issue 603 \(W-10\)\n- issue 604 \(W-9\)\n\nEach stays open until the release is published/,
  );
  assert.doesNotMatch(branch.json.pr.body, /\b(close[sd]?|fix(es|ed)?|resolve[sd]?) #\d/i);

  const rc = await hitld(['release', 'make', '--pre', 'rc'], root);
  assert.equal(rc.code, 0, JSON.stringify(rc.json));
  assert.deepEqual(rc.json.issues, p.json.issues);

  // W-12 ships in rc.2; the issues rc.1 shipped are not listed again.
  put(root, item('W-12', 'done', { source_issue: 605 }));
  commitAll(root, 'W-12 is done');
  const next = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(next.json.version, '0.1.0-rc.2');
  assert.deepEqual(next.json.items.sort(), ['W-10', 'W-11', 'W-12', 'W-3', 'W-9']);
  assert.deepEqual(next.json.issues, [{ issue: 605, item: 'W-12' }]);
});

test('two items that name one issue list it once, for the first item by ID; work check says nothing of it', async () => {
  /** @param {string} id */
  const item = (id) => ({
    [`work/items/${id}-same-issue.md`]: itemText({
      id,
      title: `Same issue ${id}`,
      kind: 'work',
      state: 'done',
      project: 'W-2',
      touches: ['src/**'],
      source_issue: '700',
    }),
  });
  const root = releaseRepo({ ...item('W-10'), ...item('W-9'), ...item('W-11') });
  const checked = open(root).check();
  assert.deepEqual(checked.problems, []);
  assert.doesNotMatch(JSON.stringify(checked.warnings ?? []), /source_issue|700/);
  const p = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(p.code, 0, JSON.stringify(p.json));
  assert.deepEqual(p.json.issues, [{ issue: 700, item: 'W-9' }]);
  assert.deepEqual(p.json.releases[0].issues, [{ issue: 700, item: 'W-9' }]);
});

/** A closing keyword followed by an issue reference, as the forge reads one. */
const CLOSES_SOMETHING =
  /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)[ \t]*:?[ \t]*(([\w.-]+\/[\w.-]+)?#\d+|GH-\d+|https?:\/\/\S+\/(issues|pull)\/\d+)/i;

test('closing keywords in the release pull request body close nothing; the items keep their words', async () => {
  const forms = [
    'Fixes #12',
    'fixes: #13',
    'CLOSES #14',
    'closed #15',
    'Resolves owner/repo#16',
    'resolved: owner/repo#17',
    'Fix #18, #19',
    'close https://github.com/owner/repo/issues/20',
    'Fixed #21 and fixes #22',
    'resolved GH-23',
    'Fix GH-24, gh-25',
    'Closes: GH-26',
  ];
  for (const form of forms) {
    const out = withoutClosingReferences(`- The fix. ${form} (W-9)`);
    assert.doesNotMatch(out, CLOSES_SOMETHING, `${form} -> ${out}`);
    assert.match(out, /issue \d+/, `${form} -> ${out}`);
  }
  assert.equal(withoutClosingReferences('Fixes #12'), 'Fixes issue 12');
  assert.equal(withoutClosingReferences('fixes: owner/repo#3'), 'fixes: owner/repo issue 3');
  assert.equal(withoutClosingReferences('Fix #18, #19'), 'Fix issue 18, issue 19');
  assert.equal(withoutClosingReferences('Fixes GH-12'), 'Fixes issue 12');
  assert.equal(withoutClosingReferences('Fix GH-24, gh-25'), 'Fix issue 24, issue 25');
  assert.equal(withoutClosingReferences('See GH-12; it stays.'), 'See GH-12; it stays.');
  assert.equal(
    withoutClosingReferences('See #12; the prefix fix stays.'),
    'See #12; the prefix fix stays.',
  );

  const notes = forms.map((form, i) => ({
    [`work/items/W-${30 + i}-note.md`]: itemText({
      id: `W-${30 + i}`,
      title: `Note ${i}`,
      kind: 'work',
      state: 'done',
      project: 'W-2',
      touches: ['src/**'],
      release_note: `Something changed. ${form}`,
    }),
  }));
  const root = makeRepo({
    files: {
      ...Object.assign({}, ...notes),
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'fixture', key: 'W' },
        release: { packages: [MAIN] },
      }),
      '.human-in-the-lead/tracker.json': JSON.stringify({
        schema_version: 1,
        optional_keys: ['release_note'],
      }),
      'surface.txt': SURFACE,
      'package.json': '{ "version": "0.0.0" }\n',
    },
    commit: false,
  });
  for (const f of ['policy.json', 'tracker.json'])
    chmodSync(join(root, '.human-in-the-lead', f), 0o644);
  commitAll(root, 'fixture');
  const made = await hitld(['release', 'make', '--pre', 'rc', '--branch', 'release'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  for (const line of made.json.pr.body.split('\n')) assert.doesNotMatch(line, CLOSES_SOMETHING);
  assert.match(made.json.pr.body, /Something changed\. Fixes issue 12 \(W-30\)/);
  assert.match(made.json.pr.body, /Something changed\. resolved issue 23 \(W-39\)/);
  assert.match(made.json.pr.body, /Something changed\. Fix issue 24, issue 25 \(W-40\)/);
  assert.doesNotMatch(made.json.pr.body, /GH-\d/i);
  // The record on the branch keeps the item's own words.
  assert.match(git(root, 'show', 'release:work/releases/main/0.1.0-rc.1.md'), /Fixes #12/);
});

test('work check refuses a source_issue that is not a whole number above zero', async () => {
  for (const bad of ['abc', '0', '-3', '1.5']) {
    const root = releaseRepo({
      'work/items/W-9-bad.md': itemText({
        id: 'W-9',
        title: 'Bad issue',
        kind: 'work',
        state: 'planned',
        project: 'W-2',
        source_issue: bad,
      }),
    });
    const problems = open(root).check().problems;
    assert.ok(
      problems.some((x) => /W-9/.test(JSON.stringify(x)) && /source_issue/.test(JSON.stringify(x))),
      `${bad}: ${JSON.stringify(problems)}`,
    );
  }
});

// --- Release items carry their version, and a release waits for what they need (HITLD-129) -----

/** A work item file in the fixture tracker. @param {string} id @param {Record<string, unknown>} more */
const itemFile = (id, more = {}) => ({
  [`work/items/${id}-thing.md`]: itemText({
    id,
    title: `Thing ${id}`,
    kind: 'work',
    state: 'planned',
    project: 'W-2',
    ...more,
  }),
});

/** The ids of a proposal's gates. @param {{ json: { gates: { id: string }[] } }} p */
const gateIds = (p) => p.json.gates.map((g) => g.id);

const WAITING = /the release waits for its gates: /;

test('an open item the release item needs is a gate; make refuses while it is open', async () => {
  const root = releaseRepo(itemFile('W-8', { release: '0.1.0', needs: ['W-3', 'W-4'] }));
  const p = await hitld(['release', 'propose'], root);
  assert.equal(p.json.release_item, 'W-8', 'found by its version, with no --item');
  assert.deepEqual(p.json.gates, [
    {
      item: 'W-8',
      id: 'W-4',
      kind: 'item',
      title: 'Second step',
      state: 'planned',
      check_due: false,
    },
  ]);
  const refused = await hitld(['release', 'make'], root);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.error, 'release-gates-open');
  assert.match(refused.json.message, WAITING);
  assert.match(refused.json.message, /W-4 Second step \(planned\)/);
  assert.equal(git(root, 'tag', '--list').trim(), '');
  const viaItem = await hitld(['release', 'make', '--item', 'W-8'], root);
  assert.equal(viaItem.json.error, 'release-gates-open');
  assert.match(viaItem.json.message, WAITING);
});

test('a dropped item is not a gate', async () => {
  const root = releaseRepo({
    ...itemFile('W-8', { release: '0.1.0', needs: ['W-3', 'W-9'] }),
    ...itemFile('W-9', { state: 'dropped', reason: 'not needed' }),
  });
  const p = await hitld(['release', 'propose'], root);
  assert.equal(p.json.release_item, 'W-8');
  assert.deepEqual(p.json.gates, []);
  const made = await hitld(['release', 'make', '--branch', 'release'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
});

test('an open milestone the release item needs is a gate, listed as one', async () => {
  const root = releaseRepo({
    ...itemFile('W-8', { release: '0.1.0', needs: ['W-3', 'W-7'] }),
    'work/milestones/W-7-ready.md': itemText({
      id: 'W-7',
      title: 'Ready',
      kind: 'milestone',
      state: 'planned',
      project: 'W-2',
      constraints: ['W-3 c?'],
    }),
  });
  const p = await hitld(['release', 'propose'], root);
  assert.deepEqual(p.json.gates, [
    {
      item: 'W-8',
      id: 'W-7',
      kind: 'milestone',
      title: 'Ready',
      state: 'planned',
      check_due: true,
    },
  ]);
  const refused = await hitld(['release', 'make'], root);
  assert.equal(refused.json.error, 'release-gates-open');
  assert.match(refused.json.message, /W-7 Ready \(planned, check due\)/);
});

test('with everything the release item needs done, make goes ahead', async () => {
  const root = releaseRepo(itemFile('W-8', { release: '0.1.0', needs: ['W-3'] }));
  const p = await hitld(['release', 'propose'], root);
  assert.equal(p.json.release_item, 'W-8');
  assert.deepEqual(p.json.gates, []);
  const made = await hitld(['release', 'make', '--branch', 'release'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.equal(made.json.tag, 'v0.1.0');
});

// --- The record lists its release item, whose state stays as it is (HITLD-838) --------------

/** The files a commit changes. @param {string} root @param {string} rev */
const filesOf = (root, rev) =>
  git(root, 'show', '--name-only', '--format=', rev).trim().split('\n').filter(Boolean).sort();

test('release make lists the release item in the record and leaves it open', async () => {
  const root = releaseRepo(itemFile('W-8', { release: '0.1.0', needs: ['W-3'] }));
  const before = git(root, 'rev-parse', 'HEAD').trim();
  const made = await hitld(['release', 'make'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.equal(git(root, 'rev-parse', 'HEAD~1').trim(), before, 'one commit');
  assert.deepEqual(filesOf(root, 'HEAD'), ['work/releases/main/0.1.0.md'], 'the record alone');
  assert.equal(git(root, 'status', '--porcelain').trim(), '');
  const record = readFileSync(join(root, 'work/releases/main/0.1.0.md'), 'utf8');
  assert.match(record, /\nitems: \[W-3, W-8\]\n/);
  const t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.equal(t.get('W-8').state, 'planned', 'open until the release is published');
  assert.equal(t.get('W-8').released_in, 'v0.1.0', 'the release it shipped in');
  // Closed by hand after publishing, it is not proposed again.
  put(root, itemFile('W-8', { release: '0.1.0', needs: ['W-3'], state: 'done' }));
  commitAll(root, 'close W-8 after publishing');
  const next = await hitld(['release', 'propose'], root);
  assert.equal(next.json.items.includes('W-8'), false);
});

test('release make --branch lists the release item in the record on the branch', async () => {
  const root = releaseRepo(itemFile('W-8', { release: '0.1.0-rc.1', needs: ['W-3'] }));
  const made = await hitld(['release', 'make', '--pre', 'rc', '--branch', 'release'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.deepEqual(filesOf(root, 'release'), ['work/releases/main/0.1.0-rc.1.md']);
  assert.match(
    git(root, 'show', 'release:work/releases/main/0.1.0-rc.1.md'),
    /\nitems: \[W-3, W-8\]\n/,
  );
  assert.match(git(root, 'show', 'release:work/items/W-8-thing.md'), /\nstate: planned\n/);
  const sha = squash(root, 'release', 'Release v0.1.0-rc.1 (#7)');
  const r = await checkReleaseCommit({ root, commit: sha, prs: [7] });
  assert.equal(r.ok, true, r.problems.join('\n'));
});

test('a done release item is listed once and kept done; a dropped one is not listed', async () => {
  const done = releaseRepo(itemFile('W-8', { release: '0.1.0', needs: ['W-3'], state: 'done' }));
  assert.equal((await hitld(['release', 'make'], done)).code, 0);
  const listed = readFileSync(join(done, 'work/releases/main/0.1.0.md'), 'utf8');
  assert.equal((listed.match(/W-8/g) ?? []).length, 1, 'listed once');
  assert.deepEqual(filesOf(done, 'HEAD'), ['work/releases/main/0.1.0.md']);
  assert.equal(open(done).get('W-8').state, 'done');

  const dropped = releaseRepo(
    itemFile('W-8', { release: '0.1.0', needs: ['W-3'], state: 'dropped' }),
  );
  const made = await hitld(['release', 'make'], dropped);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.match(
    readFileSync(join(dropped, 'work/releases/main/0.1.0.md'), 'utf8'),
    /\nitems: \[W-3\]\n/,
  );
  assert.deepEqual(filesOf(dropped, 'HEAD'), ['work/releases/main/0.1.0.md']);
  assert.equal(open(dropped).get('W-8').state, 'dropped');
});

test('a release with no release item lists none; an --item without a release key is not listed', async () => {
  const root = releaseRepo(itemFile('W-9', { release: '0.2.0', needs: ['W-3'] }));
  const made = await hitld(['release', 'make'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.equal(made.json.tag, 'v0.1.0');
  assert.match(
    readFileSync(join(root, 'work/releases/main/0.1.0.md'), 'utf8'),
    /\nitems: \[W-3\]\n/,
  );
  const other = releaseRepo(itemFile('W-10', { needs: ['W-3'] }));
  const named = await hitld(['release', 'make', '--item', 'W-10'], other);
  assert.equal(named.code, 0, JSON.stringify(named.json));
  assert.match(
    readFileSync(join(other, 'work/releases/main/0.1.0.md'), 'utf8'),
    /\nitems: \[W-3\]\n/,
  );
  assert.equal(open(other).get('W-10').state, 'planned');
});

test('work close still refuses a planned release item, on main too', async () => {
  const root = releaseRepo(itemFile('W-8', { release: '0.1.0', needs: ['W-3'] }));
  assert.equal((await hitld(['release', 'make'], root)).code, 0);
  const refused = await hitld(['work', 'close', 'W-8'], root);
  assert.equal(refused.code, 1);
  assert.match(refused.json.message, /W-8 is planned; close an item that this branch claimed/);
});

test('the release item is found by the version proposed or made; --item overrides it', async () => {
  const root = releaseRepo({
    ...itemFile('W-8', { release: '0.1.0-rc.1', needs: ['W-4'] }),
    ...itemFile('W-9', { release: '0.2.0', needs: ['W-3'] }),
    ...itemFile('W-10', { needs: ['W-5'] }),
  });
  const rc = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(rc.json.version, '0.1.0-rc.1');
  assert.equal(rc.json.release_item, 'W-8');
  assert.deepEqual(gateIds(rc), ['W-4']);
  // A version with no release item and no --item: nothing is a gate, as before.
  const full = await hitld(['release', 'propose'], root);
  assert.equal(full.json.release_item, null);
  assert.deepEqual(full.json.gates, []);
  // --item names another item, which has no release key, and wins.
  const named = await hitld(['release', 'propose', '--pre', 'rc', '--item', 'W-10'], root);
  assert.equal(named.json.release_item, 'W-10');
  assert.deepEqual(gateIds(named), ['W-5']);
  // make looks up the version it makes: --version 0.2.0 finds W-9, whose need is done.
  const made = await hitld(['release', 'make', '--version', '0.2.0', '--branch', 'r2'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  // An item whose release is another version is refused, by propose and by make.
  const wrong = await hitld(['release', 'propose', '--item', 'W-9'], root);
  assert.equal(wrong.code, 1);
  assert.equal(wrong.json.error, 'release-item-mismatch');
  assert.match(
    wrong.json.message,
    /W-9 is the release item for 0\.2\.0, but this release is 0\.1\.0/,
  );
  const wrongMake = await hitld(['release', 'make', '--version', '0.3.0', '--item', 'W-9'], root);
  assert.equal(wrongMake.json.error, 'release-item-mismatch');
  assert.match(wrongMake.json.message, /release item for 0\.2\.0, but this release is 0\.3\.0/);
});

test('work check refuses two release items for one package and version and a release that is not a version', async () => {
  const root = releaseRepo({
    ...itemFile('W-8', { release: '0.1.0' }),
    ...itemFile('W-9', { release: '0.1.0' }),
    ...itemFile('W-10', { release: 'v0.2' }),
    ...itemFile('W-11', { release: '0.3.0' }),
  });
  const checked = await hitld(['work', 'check'], root);
  assert.equal(checked.code, 1);
  const problems = checked.json.problems.join('\n');
  assert.match(
    problems,
    /release main@0\.1\.0: set on W-8 and W-9; one release item per package and version/,
  );
  assert.match(problems, /W-10-thing\.md: release "v0\.2" isn't a version/);
  assert.doesNotMatch(problems, /W-11/);
});

test('the release workflow check refuses a record while the release item waits for something', async () => {
  const root = releaseRepo(itemFile('W-8', { release: '0.1.0', needs: ['W-3'] }));
  assert.equal((await hitld(['release', 'make', '--branch', 'release'], root)).code, 0);
  // Before the merge, main changes: the release item now needs an open item.
  put(root, itemFile('W-8', { release: '0.1.0', needs: ['W-3', 'W-4'] }));
  commitAll(root, 'the release item needs more');
  squash(root);
  const r = await checkReleaseCommit({ root, prs: [7] });
  assert.equal(r.ok, false);
  assert.match(
    r.problems.join('\n'),
    /the release item W-8 for 0\.1\.0 still waits for its gates: W-4 Second step \(planned\)/,
  );
});

// --- The release pull request and the record-to-tag check (HITLD-79) ------------------------

/** Squash-merge a branch into main, as GitHub's merge button does. @param {string} root */
function squash(root, branch = 'release', subject = 'Release v0.1.0 (#7)') {
  git(root, 'merge', '-q', '--squash', branch);
  git(root, 'commit', '-q', '-m', subject, '-m', 'Signed-off-by: Owner <owner@example.invalid>');
  return git(root, 'rev-parse', 'HEAD').trim();
}

test('release make --branch puts the record on a new branch, tags nothing and returns to main', async () => {
  const root = releaseRepo();
  const before = git(root, 'rev-parse', 'HEAD').trim();
  const made = await hitld(['release', 'make', '--branch', 'release'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.equal(made.json.tag, 'v0.1.0');
  assert.equal(made.json.branch, 'release');
  assert.equal(made.json.tagged, false);
  assert.equal(made.json.pushed, false);
  assert.equal(made.json.pr.title, 'Release v0.1.0');
  assert.match(made.json.pr.body, /- Bump: minor, from no release yet/);
  assert.match(
    made.json.pr.body,
    /## Interface delta\n\n- additive surface: surface\.txt: added schema thing\n/,
  );
  assert.match(made.json.pr.body, /Squash-merge this pull request with your `Signed-off-by:`/);
  assert.match(made.json.next, /git push origin release/);
  assert.equal(git(root, 'tag', '--list').trim(), '', 'nothing was tagged');
  assert.equal(git(root, 'symbolic-ref', '--short', 'HEAD').trim(), 'main');
  assert.equal(git(root, 'rev-parse', 'HEAD').trim(), before, 'main is unchanged');
  assert.equal(git(root, 'status', '--porcelain').trim(), '');
  assert.equal(git(root, 'rev-parse', 'release~1').trim(), before, 'the branch is made from main');
  assert.equal(made.json.commit, git(root, 'rev-parse', 'release').trim());
  assert.match(
    git(root, 'show', 'release:work/releases/main/0.1.0.md'),
    /^---\nid: v0\.1\.0\npackage: main\n/,
  );
  assert.match(git(root, 'log', '-1', '--format=%B', 'release'), /^Signed-off-by: Fixture/m);

  const again = await hitld(['release', 'make', '--branch', 'release'], root);
  assert.equal(again.code, 1);
  assert.match(again.json.message, /branch release already exists/);
  const onMain = await hitld(['release', 'make', '--branch', 'main'], root);
  assert.match(onMain.json.message, /names a new branch, not main/);
  const bad = await hitld(['release', 'make', '--branch', 'a..b'], root);
  assert.match(bad.json.message, /not a valid branch name/);
  const guarded = await hitld(['release', 'make', '--branch', 'other'], root, {
    HITLD_ROLE: 'executor',
  });
  assert.equal(guarded.json.error, 'not-permitted');
  assert.equal(git(root, 'branch', '--list', 'other').trim(), '');
});

test('the record-to-tag check passes a squash-merged release pull request', async () => {
  const root = releaseRepo();
  assert.equal((await hitld(['release', 'make', '--branch', 'release'], root)).code, 0);
  const sha = squash(root);
  const r = await checkReleaseCommit({ root, prs: [7] });
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.equal(r.commit, sha);
  assert.equal(r.tag, 'v0.1.0');
  assert.equal(r.prerelease, false);
  assert.equal(r.pr, 7);
  assert.equal(r.proposed, '0.1.0');
  assert.equal(r.record, 'work/releases/main/0.1.0.md');
  assert.equal(r.message, 'v0.1.0\n\nNo release notes.');
  assert.equal(git(root, 'worktree', 'list').trim().split('\n').length, 1, 'no worktree left');

  const elsewhere = await checkReleaseCommit({ root, prs: [8] });
  assert.match(elsewhere.problems.join('\n'), /names #7, but GitHub links the commit to #8/);

  // A later commit that adds no record: nothing to release.
  put(root, { 'src/x.js': 'x\n' });
  commitAll(root, 'internal (#8)');
  const none = await checkReleaseCommit({ root });
  assert.equal(none.ok, true);
  assert.equal(none.tag, null);
});

test('the record-to-tag check passes the next pre-release', async () => {
  const root = releaseRepo();
  git(root, 'tag', '-a', 'v0.1.0-rc.1', '-m', 'rc.1');
  const made = await hitld(['release', 'make', '--pre', 'rc', '--branch', 'rc'], root);
  assert.equal(made.json.tag, 'v0.1.0-rc.2');
  squash(root, 'rc', 'Release v0.1.0-rc.2 (#3)');
  const r = await checkReleaseCommit({ root });
  assert.deepEqual(r.problems, []);
  assert.equal(r.prerelease, true);
});

test('the record-to-tag check refuses an existing tag, a wrong version and a commit not from a pull request', async () => {
  const root = releaseRepo();
  assert.equal((await hitld(['release', 'make', '--branch', 'release'], root)).code, 0);
  const record = git(root, 'show', 'release:work/releases/main/0.1.0.md');
  squash(root);
  git(root, 'tag', '-a', 'v0.1.0', '-m', 'by hand', 'HEAD~1');
  const tagged = await checkReleaseCommit({ root });
  assert.equal(tagged.ok, false);
  assert.match(tagged.problems.join('\n'), /tag v0\.1\.0 already exists/);

  // A record whose version is not the one release propose gives at the parent.
  const wrong = releaseRepo();
  put(wrong, {
    'work/releases/main/0.2.0.md': record
      .replace('id: v0.1.0', 'id: v0.2.0')
      .replace('version: 0.1.0', 'version: 0.2.0'),
  });
  commitAll(wrong, 'Release v0.2.0 (#9)');
  const r = await checkReleaseCommit({ root: wrong });
  assert.equal(r.ok, false);
  assert.equal(r.proposed, '0.1.0');
  assert.deepEqual(r.problems.length, 1);
  assert.match(
    r.problems[0],
    /^v0\.2\.0 is not the next release: at the parent, release propose --package main gives 0\.1\.0 /,
  );

  // The right record, pushed straight to main rather than merged from a pull request.
  const direct = releaseRepo();
  put(direct, { 'work/releases/main/0.1.0.md': record });
  commitAll(direct, 'release record: v0.1.0');
  const d = await checkReleaseCommit({ root: direct });
  assert.equal(d.ok, false);
  assert.match(d.problems.join('\n'), /did not arrive through a pull request/);

  // A commit that is not on main.
  const side = releaseRepo();
  git(side, 'switch', '-q', '-c', 'side');
  put(side, { 'work/releases/main/0.1.0.md': record });
  commitAll(side, 'Release v0.1.0 (#7)');
  const s = await checkReleaseCommit({ root: side, main: 'main' });
  assert.match(s.problems.join('\n'), /is not on main/);

  // A record that does not pass the release checks.
  const broken = releaseRepo();
  put(broken, { 'work/releases/main/0.1.0.md': record.replace('bump: minor', 'bump: huge') });
  commitAll(broken, 'Release v0.1.0 (#7)');
  const b = await checkReleaseCommit({ root: broken });
  assert.equal(b.ok, false);
  assert.match(b.problems[0], /^record work\/releases\/main\/0\.1\.0\.md: /);
});

test('the release-check script prints the result and writes the workflow files', async () => {
  const root = releaseRepo();
  assert.equal((await hitld(['release', 'make', '--branch', 'release'], root)).code, 0);
  squash(root);
  const dir = tempDir('hitld-release-out-');
  const script = join(ROOT, 'core/bin/release-check.mjs');
  const run = (/** @type {string[]} */ args) =>
    spawnSync(process.execPath, [script, '--repo', root, ...args], { encoding: 'utf8' });
  const ok = run([
    '--pr',
    '7',
    '--output',
    join(dir, 'out'),
    '--message-file',
    join(dir, 'msg'),
    '--notes-file',
    join(dir, 'notes'),
  ]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).tag, 'v0.1.0');
  assert.equal(
    readFileSync(join(dir, 'out'), 'utf8'),
    'tag=v0.1.0\nversion=0.1.0\nprerelease=false\nrecord=work/releases/main/0.1.0.md\n',
  );
  assert.equal(readFileSync(join(dir, 'msg'), 'utf8'), 'v0.1.0\n\nNo release notes.\n');
  assert.match(
    readFileSync(join(dir, 'notes'), 'utf8'),
    /Release record: `work\/releases\/main\/0\.1\.0\.md`/,
  );
  const refused = run(['--pr', '8']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /refused:\n {2}- the subject names #7/);
  assert.equal(run(['--pr', 'x']).status, 2);
});
