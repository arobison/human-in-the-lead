// Release packages (HITLD-752, HITLD-759): packages declared in policy.json, each with its own tag
// template, surface file, version and records; dependencies and the dependents list; lockstep
// groups; release trains; pre-release channels; and the migration of repository-wide releases
// into the package main.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import {
  checkPackages,
  declaredPackages,
  dependencyCycles,
  packagesOfFile,
  satisfies,
  surfaceDelta,
  tagFor,
  templatesOverlap,
  versionOfTag,
} from '../lib/release/packages.mjs';
import { loadRecords } from '../lib/install/upgrade.mjs';
import { checkReleaseCommit } from '../lib/release/check.mjs';
import { applyMigration, planMigration } from '../lib/release/migrate.mjs';
import { loadPolicy } from '../lib/policy/policy.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { compileTerms } from '../lib/guard/private-terms.mjs';
import { commitAll, git, itemText, makeRepo, put } from './tracker-fixture.mjs';

/** @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} [env] */
async function hitld(argv, cwd, env = {}) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, json: JSON.parse(out) };
}

/**
 * A fixture repository whose policy.json declares these packages.
 * @param {Record<string, unknown>[] | null} packages null: no release section
 * @param {Record<string, string>} [files]
 */
function repo(packages, files = {}) {
  const root = makeRepo({
    files: {
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'fixture', key: 'W' },
        ...(packages ? { release: { packages } } : {}),
      }),
      ...files,
    },
    commit: false,
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAll(root, 'fixture');
  return root;
}

/** Commit files under a work item's trailer. @param {string} root @param {string} id @param {Record<string, string>} files */
function workCommit(root, id, files) {
  put(root, files);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', `work on ${id}`, '-m', `Work-Item: ${id}`);
}

/** A work item file. @param {string} id @param {Record<string, unknown>} more */
const item = (id, more = {}) => ({
  [`work/items/${id}-thing.md`]: itemText({
    id,
    title: `Thing ${id}`,
    kind: 'work',
    state: 'planned',
    project: 'W-2',
    ...more,
  }),
});

const CORE = {
  name: 'core',
  paths: ['core/**'],
  surface: 'core/surface.txt',
};
const APP = {
  name: 'app',
  tag: '{name}/v{version}',
  paths: ['app/**'],
  surface: 'app/surface.txt',
};
const TWO = {
  'core/surface.txt': 'fn parse\n',
  'core/index.js': 'export {};\n',
  'app/surface.txt': 'cmd run\n',
  'app/main.js': 'export {};\n',
};

// --- The model: templates, ranges, paths, the surface delta ----------------------------------

test('a tag template fills and reads back; two templates that could match one tag overlap', () => {
  const [core, app, plain] = declaredPackages({
    release: {
      packages: [
        { name: 'core', paths: ['**'] },
        { name: 'app', tag: '{name}/v{version}', paths: ['**'] },
        { name: 'main', tag: 'v{version}', paths: ['**'] },
      ],
    },
  });
  assert.equal(core.tag, '{name}@{version}', 'the default template');
  assert.deepEqual(core.channels, ['alpha', 'beta', 'rc'], 'the default channels');
  assert.equal(tagFor(core, '1.2.0'), 'core@1.2.0');
  assert.equal(tagFor(app, '1.2.0-rc.1'), 'app/v1.2.0-rc.1');
  assert.equal(versionOfTag(app, 'app/v1.2.0-rc.1'), '1.2.0-rc.1');
  assert.equal(versionOfTag(app, 'core@1.2.0'), null);
  assert.equal(versionOfTag(plain, 'v0.1.0-rc.1'), '0.1.0-rc.1');
  assert.equal(versionOfTag(plain, 'vnext'), null);
  assert.equal(templatesOverlap(core, app), false);
  assert.equal(templatesOverlap(core, plain), false);
  // v{version} and v1{version}: v11.0.0 is both 11.0.0 and 1.0.0.
  assert.equal(templatesOverlap(plain, { name: 'x', tag: 'v1{version}' }), true);
  // core-{version} and core-1.2.3-{version}: core-1.2.3-1.0.0 is both.
  assert.equal(
    templatesOverlap(
      { name: 'a', tag: 'core-{version}' },
      { name: 'b', tag: 'core-1.2.3-{version}' },
    ),
    true,
  );
  assert.equal(
    templatesOverlap({ name: 'a', tag: 'x-{version}' }, { name: 'b', tag: 'x-y-{version}' }),
    false,
  );
  assert.equal(templatesOverlap({ name: 'v', tag: '{name}{version}' }, plain), true);
});

test('version ranges: exact, caret, tilde, comparisons and *', () => {
  assert.equal(satisfies('1.2.0', '1.2.0'), true);
  assert.equal(satisfies('1.4.0', '^1.2.0'), true);
  assert.equal(satisfies('2.0.0', '^1.2.0'), false);
  assert.equal(satisfies('1.3.0-rc.1', '^1.2.0'), true, 'a pre-release inside the range');
  assert.equal(satisfies('2.0.0-rc.1', '^1.2.0'), false);
  assert.equal(satisfies('0.2.5', '^0.2.0'), true);
  assert.equal(satisfies('0.3.0', '^0.2.0'), false, '^ keeps the leftmost non-zero part');
  assert.equal(satisfies('1.2.9', '~1.2.0'), true);
  assert.equal(satisfies('1.3.0', '~1.2.0'), false);
  assert.equal(satisfies('1.5.0', '>=1.2.0 <2.0.0'), true);
  assert.equal(satisfies('2.0.0', '>=1.2.0 <2.0.0'), false);
  assert.equal(satisfies('9.9.9', '*'), true);
  assert.equal(satisfies('1.0.0', 'latest'), false, 'a range this does not read');
});

test('a file belongs to the package whose most specific glob holds it', () => {
  const packages = declaredPackages({
    release: {
      packages: [
        { name: 'main', paths: ['**'] },
        { name: 'docs', paths: ['docs/**'] },
        { name: 'core', paths: ['core/**', 'shared/core.js'] },
      ],
    },
  });
  assert.deepEqual(packagesOfFile(packages, 'docs/a.md'), ['docs']);
  assert.deepEqual(packagesOfFile(packages, 'core/x/y.js'), ['core']);
  assert.deepEqual(packagesOfFile(packages, 'shared/core.js'), ['core']);
  assert.deepEqual(packagesOfFile(packages, 'README.md'), ['main']);
});

test('the surface delta: added lines additive, removed and changed lines breaking', () => {
  assert.deepEqual(surfaceDelta('a\nb\n', 'a\nb\n', 's.txt'), []);
  assert.deepEqual(surfaceDelta('a\n', 'a\n# note\n\nc\n', 's.txt'), [
    { impact: 'additive', surface: 'surface', what: 's.txt: added c' },
  ]);
  assert.deepEqual(surfaceDelta('a\nb\n', 'a\nB\n', 's.txt'), [
    { impact: 'breaking', surface: 'surface', what: 's.txt: removed b' },
    { impact: 'additive', surface: 'surface', what: 's.txt: added B' },
  ]);
  assert.deepEqual(surfaceDelta(null, 'x\n', 's.txt').length, 1, 'no file at the base: all new');
});

test('the package check refuses overlapping templates, unknown dependencies, cycles and mixed group channels', () => {
  const problems = checkPackages(
    declaredPackages({
      release: {
        packages: [
          { name: 'a', tag: 'v{version}', paths: ['a/**'], depends_on: { b: '^1.0.0' } },
          { name: 'b', tag: 'v1{version}', paths: ['b/**'], depends_on: { a: '^1.0.0' } },
          { name: 'c', paths: ['c/**'], depends_on: { nowhere: '1.0.0', a: 'soon' } },
          { name: 'd', paths: ['d/**'], group: 'g', channels: ['rc'] },
          { name: 'e', paths: ['e/**'], group: 'g' },
          { name: 'f', tag: '{version}-{name}', paths: ['f/**'] },
          { name: 'h', paths: ['h/**'], surface: 'elsewhere/surface.txt' },
        ],
      },
    }),
  ).join('\n');
  assert.match(problems, /a \(v\{version\}\) and b \(v1\{version\}\) could match the same tag/);
  assert.match(problems, /c: depends on nowhere, which is not declared/);
  assert.match(problems, /c: depends_on a: "soon" is not a version range/);
  assert.match(problems, /a dependency cycle, a → b → a/);
  assert.match(
    problems,
    /group g \(d, e\) shares one version, so its packages need the same channels/,
  );
  assert.match(problems, /f: tag template "\{version\}-\{name\}" must end with \{version\}/);
  assert.match(problems, /h: surface file elsewhere\/surface\.txt is outside the package's paths/);
  assert.deepEqual(
    dependencyCycles(declaredPackages({ release: { packages: [{ name: 'x', paths: ['**'] }] } })),
    [],
  );
});

// --- work check -------------------------------------------------------------------------------

test('work check refuses overlapping templates, an undeclared package and a dependency cycle', async () => {
  const root = repo(
    [
      { ...CORE, tag: 'v{version}', depends_on: { app: '*' } },
      { ...APP, tag: 'v1{version}', depends_on: { core: '*' } },
    ],
    {
      ...TWO,
      ...item('W-8', { release: '0.1.0', package: 'web' }),
      ...item('W-9', { release: '0.1.0' }),
      'work/milestones/W-7-ready.md': itemText({
        id: 'W-7',
        title: 'Ready',
        kind: 'milestone',
        state: 'planned',
        package: 'web',
      }),
    },
  );
  const checked = await hitld(['work', 'check'], root);
  assert.equal(checked.code, 1);
  const problems = checked.json.problems.join('\n');
  assert.match(
    problems,
    /core \(v\{version\}\) and app \(v1\{version\}\) could match the same tag/,
  );
  assert.match(problems, /a dependency cycle, core → app → core/);
  assert.match(
    problems,
    /W-8-thing\.md: package web is not declared in policy\.json release\.packages/,
  );
  assert.match(problems, /W-7-ready\.md: package web is not declared/);
  assert.match(
    problems,
    /W-9-thing\.md: release 0\.1\.0 names no package; 2 release packages are declared/,
  );
});

test('work check passes two well-declared packages, and a release item unique per package and version', async () => {
  const root = repo([CORE, APP], {
    ...TWO,
    ...item('W-8', { release: '0.1.0', package: 'core' }),
    ...item('W-9', { release: '0.1.0', package: 'app' }),
  });
  const ok = await hitld(['work', 'check'], root);
  assert.deepEqual(ok.json.problems, []);
  put(root, item('W-10', { release: '0.1.0', package: 'core' }));
  commitAll(root, 'a second release item for core 0.1.0');
  const twice = await hitld(['work', 'check'], root);
  assert.match(
    twice.json.problems.join('\n'),
    /release core@0\.1\.0: set on W-8 and W-10; one release item per package and version/,
  );
});

// --- Two packages, different templates --------------------------------------------------------

test('two packages in one repository: own templates, own tags, own records, items by the files they touch', async () => {
  const root = repo([CORE, APP], TWO);
  const which = await hitld(['release', 'propose'], root);
  assert.equal(which.json.error, 'package-required');
  const unknown = await hitld(['release', 'propose', '--package', 'web'], root);
  assert.equal(unknown.json.error, 'unknown-package');

  workCommit(root, 'W-3', { 'core/index.js': 'export const a = 1;\n' });
  const core = await hitld(['release', 'propose', '--package', 'core'], root);
  assert.equal(core.code, 0, JSON.stringify(core.json));
  assert.equal(core.json.tag, 'core@0.1.0');
  assert.deepEqual(core.json.items, ['W-3'], 'W-3 touched core');
  const app = await hitld(['release', 'propose', '--package', 'app'], root);
  assert.equal(app.json.tag, 'app/v0.1.0');
  assert.deepEqual(app.json.items, [], 'W-3 touched nothing of app');

  const made = await hitld(['release', 'make', '--package', 'core'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.equal(made.json.tag, 'core@0.1.0');
  assert.equal(made.json.record, 'work/releases/core/0.1.0.md');
  assert.match(
    readFileSync(join(root, 'work/releases/core/0.1.0.md'), 'utf8'),
    /^---\nid: core@0\.1\.0\npackage: core\nversion: 0\.1\.0\n/,
  );
  // A tag of another package never counts as core's.
  git(root, 'tag', '-a', 'app/v0.4.0', '-m', 'app by hand');
  put(root, { 'core/surface.txt': 'fn parse\nfn print\n' });
  commitAll(root, 'core grows');
  const next = await hitld(['release', 'propose', '--package', 'core'], root);
  assert.equal(next.json.last_tag, 'core@0.1.0');
  assert.equal(next.json.base, 'core@0.1.0');
  assert.equal(next.json.version, '0.2.0');
  const appNext = await hitld(['release', 'propose', '--package', 'app'], root);
  assert.equal(appNext.json.base, 'app/v0.4.0');
  assert.equal(appNext.json.version, '0.4.1', 'no change to app/surface.txt: patch');
  const checked = await hitld(['work', 'check'], root);
  assert.deepEqual(checked.json.problems, []);
  const shown = await hitld(['work', 'show', 'core@0.1.0'], root);
  assert.equal(shown.json.entity.package, 'core');
});

test('a package with no surface file gets no proposed version; the owner names it, a patch included', async () => {
  const root = repo([{ name: 'tool', paths: ['**'] }]);
  const p = await hitld(['release', 'propose'], root);
  assert.equal(p.code, 0, JSON.stringify(p.json));
  assert.equal(p.json.package, 'tool', '--package may be left out with one package');
  assert.equal(p.json.surface, null);
  assert.equal(p.json.interface_measured, false);
  assert.deepEqual(p.json.interface_delta, []);
  assert.equal(p.json.version, null);
  assert.equal(p.json.tag, null);
  assert.equal(p.json.bump, null);
  assert.match(p.json.reason, /tool declares no surface file, so no version is proposed/);
  assert.deepEqual(p.json.items, ['W-3'], 'the items and notes are still drafted');
  const rc = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(rc.json.version, null, 'no pre-release is proposed either');
  const unnamed = await hitld(['release', 'make'], root);
  assert.equal(unnamed.code, 1);
  assert.match(
    unnamed.json.message,
    /no version is proposed: name it with --version.*such as 0\.1\.0/,
  );
  assert.equal(git(root, 'tag', '--list').trim(), '');
  const made = await hitld(['release', 'make', '--version', '0.1.0'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.equal(made.json.tag, 'tool@0.1.0');
  const patch = await hitld(['release', 'make', '--version', '0.1.1'], root);
  assert.equal(patch.code, 0, JSON.stringify(patch.json));
  assert.equal(patch.json.tag, 'tool@0.1.1', 'a patch, named by the owner');
  const below = await hitld(['release', 'make', '--version', '0.1.1'], root);
  assert.match(below.json.message, /not above the last full release, 0\.1\.1/);
  const pre = await hitld(['release', 'make', '--version', '0.2.0-rc.1', '--branch', 'rel'], root);
  assert.equal(pre.code, 0, JSON.stringify(pre.json));
  assert.deepEqual((await hitld(['work', 'check'], root)).json.problems, []);
});

test('the record-to-tag check accepts the version the owner named for a package with no surface file', async () => {
  const root = repo([{ name: 'tool', tag: 'v{version}', paths: ['**'] }]);
  assert.equal(
    (await hitld(['release', 'make', '--version', '0.3.0', '--branch', 'rel'], root)).code,
    0,
  );
  git(root, 'merge', '-q', '--squash', 'rel');
  git(
    root,
    'commit',
    '-q',
    '-m',
    'Release v0.3.0 (#4)',
    '-m',
    'Signed-off-by: Owner <owner@example.invalid>',
  );
  const r = await checkReleaseCommit({ root, prs: [4] });
  assert.deepEqual(r.problems, []);
  assert.equal(r.tag, 'v0.3.0');
  assert.equal(r.record, 'work/releases/tool/0.3.0.md');
});

// --- Dependencies and the dependents list -----------------------------------------------------

test('a dependency is pinned in the record; a release out of its range is refused; dependents of a breaking change are listed', async () => {
  const root = repo([CORE, { ...APP, depends_on: { core: '^0.1.0' } }], TWO);
  const early = await hitld(['release', 'make', '--package', 'app'], root);
  assert.equal(early.json.error, 'dependency-out-of-range');
  assert.match(early.json.message, /app depends on core \^0\.1\.0, but core is not released yet/);
  assert.equal((await hitld(['release', 'make', '--package', 'core'], root)).code, 0);
  const app = await hitld(['release', 'propose', '--package', 'app'], root);
  assert.deepEqual(app.json.depends, [
    { package: 'core', range: '^0.1.0', version: '0.1.0', satisfied: true },
  ]);
  const made = await hitld(['release', 'make', '--package', 'app'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.match(
    readFileSync(join(root, 'work/releases/app/0.1.0.md'), 'utf8'),
    /\ndepends: \[core@0\.1\.0\]\n/,
  );
  // A breaking change to core: app depends on it, and the new version leaves app's range.
  put(root, { 'core/surface.txt': 'fn parse2\n' });
  commitAll(root, 'core breaks');
  const core = await hitld(['release', 'propose', '--package', 'core'], root);
  assert.equal(core.json.breaking, true);
  assert.equal(core.json.version, '0.2.0');
  assert.deepEqual(core.json.dependents, [
    { package: 'app', depends_on: 'core', range: '^0.1.0', in_range: false },
  ]);
  const checked = await hitld(['work', 'check'], root);
  assert.deepEqual(checked.json.problems, []);
});

// --- Lockstep groups --------------------------------------------------------------------------

test('a lockstep group shares one version: one release makes a record and a tag for each package', async () => {
  const root = repo(
    [
      { ...CORE, group: 'sdk' },
      { ...APP, group: 'sdk' },
    ],
    TWO,
  );
  assert.equal((await hitld(['release', 'make', '--package', 'core'], root)).code, 0);
  put(root, { 'app/surface.txt': 'cmd run\ncmd stop\n' });
  commitAll(root, 'app grows');
  const p = await hitld(['release', 'propose', '--package', 'core'], root);
  assert.equal(p.json.group, 'sdk');
  assert.equal(p.json.version, '0.2.0', 'the group takes the highest bump of its packages');
  assert.deepEqual(
    p.json.releases.map((/** @type {any} */ r) => [r.package, r.tag]),
    [
      ['core', 'core@0.2.0'],
      ['app', 'app/v0.2.0'],
    ],
  );
  const branch = await hitld(['release', 'make', '--package', 'app', '--branch', 'rel'], root);
  assert.equal(branch.code, 1);
  assert.match(
    branch.json.message,
    /writes 2 records .*make a release of several packages on main/,
  );
  const made = await hitld(['release', 'make', '--package', 'app', '--pre', 'rc'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.deepEqual(made.json.tags, ['core@0.2.0-rc.1', 'app/v0.2.0-rc.1']);
  assert.equal(
    git(root, 'log', '-1', '--format=%s').trim(),
    'release record: core@0.2.0-rc.1, app/v0.2.0-rc.1',
  );
  assert.ok(existsSync(join(root, 'work/releases/app/0.2.0-rc.1.md')));
  const checked = await hitld(['work', 'check'], root);
  assert.deepEqual(checked.json.problems, []);
});

// --- Release trains ---------------------------------------------------------------------------

test('a release train makes several packages’ releases together, in one approval, and waits for all their gates', async () => {
  const root = repo([CORE, { ...APP, depends_on: { core: '^0.1.0' } }], {
    ...TWO,
    ...item('W-20', { release: '0.1.0', package: 'core', needs: ['W-3'] }),
    ...item('W-21', { release: '0.1.0', package: 'app', needs: ['W-4'] }),
    ...item('W-22', { needs: ['W-20', 'W-21'] }),
    ...item('W-23', { needs: ['W-20'] }),
  });
  const single = await hitld(['release', 'propose', '--train', 'W-23'], root);
  assert.equal(single.json.error, 'not-a-train');
  const p = await hitld(['release', 'propose', '--train', 'W-22'], root);
  assert.equal(p.code, 0, JSON.stringify(p.json));
  assert.equal(p.json.train, 'W-22');
  assert.deepEqual(
    p.json.releases.map((/** @type {any} */ r) => [r.tag, r.release_item]),
    [
      ['core@0.1.0', 'W-20'],
      ['app/v0.1.0', 'W-21'],
    ],
  );
  const app = p.json.releases.find((/** @type {any} */ r) => r.package === 'app');
  assert.deepEqual(
    app.depends,
    [{ package: 'core', range: '^0.1.0', version: '0.1.0', satisfied: true }],
    'pinned to the version the train makes',
  );
  assert.deepEqual(
    p.json.gates.map((/** @type {any} */ g) => g.id),
    ['W-4'],
  );
  const waiting = await hitld(['release', 'make', '--train', 'W-22'], root);
  assert.equal(waiting.json.error, 'release-gates-open');
  put(root, item('W-21', { release: '0.1.0', package: 'app', needs: ['W-3'] }));
  commitAll(root, 'the app release needs only done work');
  const made = await hitld(['release', 'make', '--train', 'W-22'], root);
  assert.equal(made.code, 0, JSON.stringify(made.json));
  assert.deepEqual(made.json.tags, ['core@0.1.0', 'app/v0.1.0']);
  assert.equal(git(root, 'tag', '--list').trim().split('\n').length, 2);
  const record = readFileSync(join(root, 'work/releases/app/0.1.0.md'), 'utf8');
  assert.match(record, /\ndepends: \[core@0\.1\.0\]\n/);
  assert.match(record, /\ntrain: W-22\n/);
  const checked = await hitld(['work', 'check'], root);
  assert.deepEqual(checked.json.problems, []);
});

// --- Pre-release channels ---------------------------------------------------------------------

test('each pre-release channel keeps its own counter per package; a channel not declared is refused', async () => {
  const root = repo([CORE, { ...APP, channels: ['rc'] }], TWO);
  assert.equal(
    (await hitld(['release', 'make', '--package', 'core', '--pre', 'rc'], root)).code,
    0,
  );
  assert.equal(
    (await hitld(['release', 'make', '--package', 'core', '--pre', 'rc'], root)).code,
    0,
  );
  const beta = await hitld(['release', 'propose', '--package', 'core', '--pre', 'beta'], root);
  assert.equal(beta.json.version, '0.1.0-beta.1');
  const rc = await hitld(['release', 'propose', '--package', 'core', '--pre', 'rc'], root);
  assert.equal(rc.json.version, '0.1.0-rc.3');
  const appRc = await hitld(['release', 'propose', '--package', 'app', '--pre', 'rc'], root);
  assert.equal(appRc.json.version, '0.1.0-rc.1', "core's counter is not app's");
  const appBeta = await hitld(['release', 'propose', '--package', 'app', '--pre', 'beta'], root);
  assert.equal(appBeta.code, 1);
  assert.match(
    appBeta.json.message,
    /beta is not a pre-release channel of app \(its channels: rc\)/,
  );
});

// --- The migration ----------------------------------------------------------------------------

/** A repository-wide record from before packages. */
const LEGACY = `---
id: v0.1.0-rc.1
version: 0.1.0-rc.1
bump: minor
interface_delta: ["additive cli: hitld work show added"]
decision: owner
items: [W-3]
classification: public
---

## Notes

- First (W-3)
`;

test('the migration moves repository-wide releases into main, keeps every tag resolvable, and writes nothing until the owner applies it', async () => {
  const root = repo(null, {
    'package.json': '{ "version": "0.1.0-rc.1" }\n',
    'surface.txt': 'cli hitld work show\n',
    'work/releases/v0.1.0-rc.1.md': LEGACY,
  });
  git(root, 'tag', '-a', 'v0.1.0-rc.1', '-m', 'rc.1');
  const before = git(root, 'rev-parse', 'v0.1.0-rc.1^{commit}').trim();
  // Before the migration: no package, so no release command guesses one, and the old record
  // still checks.
  const none = await hitld(['release', 'propose'], root);
  assert.equal(none.json.error, 'no-packages');
  assert.match(none.json.message, /hitld release migrate/);
  assert.deepEqual((await hitld(['work', 'check'], root)).json.problems, []);

  const plan = await hitld(['release', 'migrate', '--surface', 'surface.txt'], root);
  assert.equal(plan.code, 0, JSON.stringify(plan.json));
  assert.equal(plan.json.needed, true);
  assert.equal(plan.json.applied, false);
  assert.deepEqual(plan.json.package, {
    name: 'main',
    tag: 'v{version}',
    paths: ['**'],
    surface: 'surface.txt',
    version_source: 'package.json',
  });
  assert.deepEqual(plan.json.moves, [
    {
      from: 'work/releases/v0.1.0-rc.1.md',
      to: 'work/releases/main/0.1.0-rc.1.md',
      tag: 'v0.1.0-rc.1',
    },
  ]);
  assert.deepEqual(plan.json.tags_kept, ['v0.1.0-rc.1']);
  assert.equal(git(root, 'status', '--porcelain').trim(), '', 'the plan writes nothing');

  const executor = await hitld(['release', 'migrate', '--apply'], root, { HITLD_ROLE: 'executor' });
  assert.equal(executor.json.error, 'not-permitted');
  const dispatched = await hitld(['release', 'migrate', '--apply'], root, {
    HITLD_DISPATCH: 'D-4',
  });
  assert.equal(dispatched.json.error, 'not-permitted');
  assert.equal(git(root, 'status', '--porcelain').trim(), '');

  const applied = await hitld(['release', 'migrate', '--surface', 'surface.txt', '--apply'], root);
  assert.equal(applied.code, 0, JSON.stringify(applied.json));
  assert.equal(applied.json.applied, true);
  assert.equal(git(root, 'status', '--porcelain').trim(), '', 'one commit');
  assert.equal(
    git(root, 'log', '-1', '--format=%s').trim(),
    'release migrate: the repository-wide releases into the package main',
  );
  assert.equal(existsSync(join(root, 'work/releases/v0.1.0-rc.1.md')), false);
  const moved = readFileSync(join(root, 'work/releases/main/0.1.0-rc.1.md'), 'utf8');
  assert.match(moved, /^---\nid: v0\.1\.0-rc\.1\npackage: main\nversion: 0\.1\.0-rc\.1\n/);
  assert.match(moved, /## Notes\n\n- First \(W-3\)\n/);
  const policy = JSON.parse(readFileSync(join(root, '.human-in-the-lead/policy.json'), 'utf8'));
  assert.deepEqual(
    policy.release.packages.map((/** @type {any} */ p) => p.name),
    ['main'],
  );

  // The tag is untouched and is main's; the record is found by it.
  assert.equal(git(root, 'rev-parse', 'v0.1.0-rc.1^{commit}').trim(), before);
  assert.deepEqual((await hitld(['work', 'check'], root)).json.problems, []);
  const shown = await hitld(['work', 'show', 'v0.1.0-rc.1'], root);
  assert.equal(shown.json.entity.kind, 'release');
  assert.equal(shown.json.entity.package, 'main');
  const next = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(next.json.last_tag, 'v0.1.0-rc.1');
  assert.equal(next.json.base, null, 'a pre-release is never the base');
  assert.equal(next.json.version, '0.1.0-rc.2');
  assert.deepEqual(next.json.items, ['W-3'], 'a pre-release does not release its items');
  assert.deepEqual(
    loadRecords(join(root, 'work/releases')).map((r) => r.tag),
    ['v0.1.0-rc.1'],
    'hitld upgrade plan still finds the record',
  );
  const again = await hitld(['release', 'migrate'], root);
  assert.equal(again.json.needed, false);
});

test('once a package is declared, a record left outside a package folder is refused', async () => {
  const root = repo([{ name: 'main', tag: 'v{version}', paths: ['**'] }], {
    'work/releases/v0.1.0-rc.1.md': LEGACY,
  });
  const checked = await hitld(['work', 'check'], root);
  assert.match(
    checked.json.problems.join('\n'),
    /v0\.1\.0-rc\.1\.md: is a repository-wide record from before release packages; hitld release migrate moves it/,
  );
});

// --- Upgrading to release packages (HITLD-899) ----------------------------------------------

test('work check warns while no package is declared and records from before packages exist', async () => {
  const root = repo(null, { 'work/releases/v0.1.0-rc.1.md': LEGACY });
  const checked = await hitld(['work', 'check'], root);
  assert.deepEqual(checked.json.problems, []);
  assert.match(
    checked.json.warnings.join('\n'),
    /work\/releases\/v0\.1\.0-rc\.1\.md is a release record from before release packages, and no package is declared: release propose and release make refuse \(no-packages\) until the owner runs hitld release migrate --apply/,
  );
  // No record from before packages: nothing to migrate, nothing to warn about.
  const fresh = await hitld(['work', 'check'], repo(null));
  assert.doesNotMatch(fresh.json.warnings.join('\n'), /before release packages/);
  // Once migrated, the warning is gone.
  assert.equal((await hitld(['release', 'migrate', '--apply'], root)).code, 0);
  const after = await hitld(['work', 'check'], root);
  assert.deepEqual(after.json.problems, []);
  assert.doesNotMatch(after.json.warnings.join('\n'), /before release packages/);
});

test('the record-to-tag check finds no release in the migration commit, applied or squash-merged', async () => {
  const root = repo(null, { 'work/releases/v0.1.0-rc.1.md': LEGACY });
  assert.equal((await hitld(['release', 'migrate', '--apply'], root)).code, 0);
  const direct = await checkReleaseCommit({ root });
  assert.deepEqual(direct.problems, []);
  assert.equal(direct.ok, true);
  assert.equal(direct.record, null, 'a moved record is not an added one');

  // The same migration arriving on main as a pull request's squash commit.
  const squashed = repo(null, { 'work/releases/v0.1.0-rc.1.md': LEGACY });
  git(squashed, 'switch', '-q', '-c', 'migrate');
  assert.equal((await hitld(['release', 'migrate', '--apply'], squashed)).code, 0);
  git(squashed, 'switch', '-q', 'main');
  git(squashed, 'merge', '-q', '--squash', 'migrate');
  git(squashed, 'commit', '-q', '-m', 'Move the releases into main (#9)');
  const merged = await checkReleaseCommit({ root: squashed, prs: [9] });
  assert.deepEqual(merged.problems, []);
  assert.equal(merged.ok, true);
  assert.equal(merged.record, null);

  // A commit that moves a record and adds a different one still has that one checked, and a
  // refusal at the parent is a problem, not a throw.
  const both = repo(null, { 'work/releases/v0.1.0-rc.1.md': LEGACY });
  git(both, 'switch', '-q', '-c', 'migrate');
  assert.equal((await hitld(['release', 'migrate', '--apply'], both)).code, 0);
  put(both, {
    'work/releases/main/0.1.0-rc.2.md': LEGACY.replaceAll('0.1.0-rc.1', '0.1.0-rc.2').replace(
      'id: v0.1.0-rc.2\n',
      'id: v0.1.0-rc.2\npackage: main\n',
    ),
  });
  git(both, 'add', '-A');
  git(both, 'commit', '-q', '-m', 'and a release');
  git(both, 'switch', '-q', 'main');
  git(both, 'merge', '-q', '--squash', 'migrate');
  git(both, 'commit', '-q', '-m', 'Move and release (#10)');
  const added = await checkReleaseCommit({ root: both, prs: [10] });
  assert.equal(added.ok, false);
  assert.equal(added.record, 'work/releases/main/0.1.0-rc.2.md');
  assert.match(
    added.problems.join('\n'),
    /at the parent, release propose refuses: no release package is declared/,
  );
});

test('release migrate plans the moves whenever records from before packages exist and main is declared', async () => {
  const root = repo([{ name: 'main', tag: 'v{version}', paths: ['**'] }], {
    'work/releases/v0.1.0-rc.1.md': LEGACY,
  });
  const policyBefore = readFileSync(join(root, '.human-in-the-lead/policy.json'), 'utf8');
  const plan = await hitld(['release', 'migrate'], root);
  assert.equal(plan.code, 0, JSON.stringify(plan.json));
  assert.equal(plan.json.needed, true);
  assert.equal(plan.json.package, null, 'main is declared already: policy.json is not changed');
  assert.deepEqual(plan.json.declared, ['main']);
  assert.deepEqual(plan.json.moves, [
    {
      from: 'work/releases/v0.1.0-rc.1.md',
      to: 'work/releases/main/0.1.0-rc.1.md',
      tag: 'v0.1.0-rc.1',
    },
  ]);
  assert.deepEqual(plan.json.problems, []);
  const applied = await hitld(['release', 'migrate', '--apply'], root);
  assert.equal(applied.code, 0, JSON.stringify(applied.json));
  assert.equal(applied.json.applied, true);
  assert.equal(
    readFileSync(join(root, '.human-in-the-lead/policy.json'), 'utf8'),
    policyBefore,
    'policy.json is left as it is',
  );
  assert.equal(git(root, 'status', '--porcelain').trim(), '', 'one commit');
  assert.deepEqual((await hitld(['work', 'check'], root)).json.problems, []);
  assert.equal((await hitld(['release', 'migrate'], root)).json.needed, false);
  // --surface only declares main; with main declared, it is refused rather than dropped.
  const again = repo([{ name: 'main', tag: 'v{version}', paths: ['**'] }], {
    'work/releases/v0.1.0-rc.1.md': LEGACY,
    'surface.txt': 'cli x\n',
  });
  const surfaced = await hitld(['release', 'migrate', '--surface', 'surface.txt'], again);
  assert.match(surfaced.json.problems.join('\n'), /main is declared already/);
});

test('release migrate names what is missing when packages are declared but main is not, and so does the check', async () => {
  const root = repo([{ name: 'tool', tag: 'tool@{version}', paths: ['**'] }], {
    'work/releases/v0.1.0-rc.1.md': LEGACY,
  });
  const plan = await hitld(['release', 'migrate'], root);
  assert.equal(plan.json.needed, true);
  assert.deepEqual(plan.json.moves, []);
  assert.match(plan.json.problems.join('\n'), /no package named main is declared/);
  const applied = await hitld(['release', 'migrate', '--apply'], root);
  assert.equal(applied.code, 1);
  assert.match(
    (await hitld(['work', 'check'], root)).json.problems.join('\n'),
    /v0\.1\.0-rc\.1\.md: is a repository-wide record from before release packages; declare a package named main \(tag template v\{version\}\), then hitld release migrate moves it there/,
  );
  // main declared with another tag template: the record's tag would not be main's.
  const other = repo([{ name: 'main', tag: 'main@{version}', paths: ['**'] }], {
    'work/releases/v0.1.0-rc.1.md': LEGACY,
  });
  const p = await hitld(['release', 'migrate'], other);
  assert.match(
    p.json.problems.join('\n'),
    /main's tag template \(main@\{version\}\) gives main@0\.1\.0-rc\.1, not v0\.1\.0-rc\.1/,
  );
});

test('release migrate --apply commits through the hooks, and checks the private terms and the policy itself first', async () => {
  // The hooks run: a pre-commit hook that refuses stops the commit, and the tree is put back.
  const hooked = repo(null, { 'work/releases/v0.1.0-rc.1.md': LEGACY });
  const hook = join(hooked, '.git/hooks/pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho refused by the hook >&2\nexit 1\n');
  chmodSync(hook, 0o755);
  const head = git(hooked, 'rev-parse', 'HEAD').trim();
  const refused = await hitld(['release', 'migrate', '--apply'], hooked);
  assert.equal(refused.code, 1, JSON.stringify(refused.json));
  assert.equal(git(hooked, 'rev-parse', 'HEAD').trim(), head, 'nothing committed');
  assert.equal(git(hooked, 'status', '--porcelain').trim(), '', 'the tree is put back');

  // A private term in a moved record: refused before the commit, naming the kind, never the term.
  const termed = repo(null, {
    'work/releases/v0.1.0-rc.1.md': LEGACY.replace('- First (W-3)', '- First (W-3) for Zorblaxco'),
  });
  const t = openTracker({
    repoRoot: termed,
    policy: /** @type {any} */ (loadPolicy({ cwd: termed }).policy),
    env: {},
  });
  const plan = planMigration(t);
  assert.deepEqual(plan.problems, []);
  assert.throws(
    () => applyMigration(t, plan, { terms: compileTerms([{ term: 'Zorblaxco', kind: 'name' }]) }),
    (/** @type {unknown} */ e) =>
      /private term list/.test(String(e)) && !/Zorblaxco/.test(String(e)),
  );
  assert.equal(git(termed, 'status', '--porcelain').trim(), '');

  // A moved record above the classification ceiling (policy.json's): refused the same way.
  const above = repo(null, {
    'work/releases/v0.1.0-rc.1.md': LEGACY.replace(
      'classification: public',
      'classification: internal',
    ),
  });
  const u = openTracker({
    repoRoot: above,
    policy: /** @type {any} */ (loadPolicy({ cwd: above }).policy),
    env: {},
  });
  assert.throws(
    () => applyMigration(u, planMigration(u), { terms: [] }),
    /not migrated: work\/releases\/main\/0\.1\.0-rc\.1\.md: classification "internal" .* above the repository's ceiling "public"/,
  );
  assert.equal(git(above, 'status', '--porcelain').trim(), '');
});
