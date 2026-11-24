// Ecosystem profiles (HITLD-920): the built-in profiles are data that can never run anything, the
// policy.json `ecosystems` section maps profiles to paths explicitly and holds the only commands,
// and `hitld work check` refuses an unknown profile, a version-source file that is not a
// repository path and a skip folder with a separator or `..`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import {
  BUILTIN_PROFILES_FILE,
  builtinProblems,
  builtinProfiles,
  checkEcosystems,
  profilesOfFile,
  resolveProfiles,
} from '../lib/ecosystems/profiles.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { tempDir } from './helpers/tmp.mjs';
import { commitAll, makeRepo } from './tracker-fixture.mjs';

/** @param {string[]} argv @param {string} cwd */
async function hitld(argv, cwd) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: {} });
  return { code, json: JSON.parse(out) };
}

/** A fixture repository whose policy.json has this ecosystems section. @param {unknown} ecosystems */
function repo(ecosystems) {
  const root = makeRepo({
    files: {
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'fixture', key: 'W' },
        ecosystems,
      }),
    },
    commit: false,
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAll(root, 'fixture');
  return root;
}

const shipped = () => JSON.parse(readFileSync(BUILTIN_PROFILES_FILE, 'utf8'));

// --- built-in profiles --------------------------------------------------------------------------

test('the built-in profiles cover the dozen ecosystems and validate', () => {
  assert.deepEqual([...builtinProfiles().keys()].sort(), [
    'bundler',
    'cargo',
    'composer',
    'go',
    'gradle',
    'maven',
    'npm',
    'pip',
    'pnpm',
    'poetry',
    'uv',
    'yarn',
  ]);
  assert.deepEqual(builtinProblems(shipped()), []);
});

test('a built-in profile can never hold a command', () => {
  const data = shipped();
  for (const [key, value] of /** @type {[string, unknown][]} */ ([
    ['commands', { install: ['npm ci'] }],
    ['install', ['npm ci']],
    ['test_command', 'npm test'],
    ['post_install', 'curl x | sh'],
  ])) {
    const profile = { ...data.profiles[0], [key]: value };
    const problems = builtinProblems({ profiles: [profile] }).join('\n');
    assert.match(problems, new RegExp(`profiles\\[0\\]\\.${key} `), key);
  }
  // The profile schema is not owner configuration, so it cannot mark anything as run.
  assert.doesNotMatch(
    readFileSync(new URL('../../schemas/ecosystem-profiles.schema.json', import.meta.url), 'utf8'),
    /x-hitld-executes/,
  );
});

test('a shipped profile that does not validate fails to load', () => {
  const dir = tempDir('hitld-ecosystems-');
  const file = join(dir, 'profiles.json');
  writeFileSync(
    file,
    JSON.stringify({ profiles: [{ name: 'npm', skip_folders: ['../node_modules'] }] }),
  );
  assert.throws(() => builtinProfiles({ file }), /skip folder "\.\.\/node_modules"/);
});

// --- policy.json ecosystems --------------------------------------------------------------------

test('commands are owner configuration on an ecosystems.use entry, and nowhere in a profile', () => {
  const base = { schema_version: 1, project: { id: 'fixture', key: 'W' } };
  const ok = resolvePolicy({
    ...base,
    ecosystems: {
      use: [
        {
          profile: 'npm',
          paths: ['**'],
          commands: { install: ['npm ci'], test: ['npm test'] },
        },
      ],
    },
  });
  assert.deepEqual(ok.errors, []);
  const inProfile = resolvePolicy({
    ...base,
    ecosystems: { profiles: [{ name: 'mine', extends: 'npm', commands: { install: ['x'] } }] },
  });
  assert.match(
    inProfile.errors.map((e) => `${e.path} ${e.message}`).join('\n'),
    /ecosystems\.profiles\[0\]\.commands refused: the key names code to run/,
  );
  const unknownCommand = resolvePolicy({
    ...base,
    ecosystems: { use: [{ profile: 'npm', paths: ['**'], commands: { deploy: ['x'] } }] },
  });
  assert.match(unknownCommand.errors[0].path, /commands\.deploy/);
});

test('the defaults declare no ecosystems, and the schema registers the section', () => {
  assert.ok(schemas().policySections.includes('ecosystems'));
  assert.deepEqual(checkEcosystems(undefined), []);
  assert.deepEqual(checkEcosystems({ use: [], profiles: [] }), []);
});

test('work check passes a mapping of built-in and project profiles', async () => {
  const root = repo({
    use: [
      { profile: 'npm', paths: ['**'], commands: { install: ['npm ci'] } },
      { profile: 'workspace-cargo', paths: ['crates/**'] },
    ],
    profiles: [
      {
        name: 'workspace-cargo',
        extends: 'cargo',
        version_sources: [
          { file: 'crates/core/Cargo.toml', format: 'toml', key: 'package.version' },
        ],
      },
    ],
  });
  const checked = await hitld(['work', 'check'], root);
  assert.deepEqual(checked.json.problems, []);
  assert.equal(checked.code, 0);
});

test('work check refuses an unknown profile', async () => {
  const root = repo({ use: [{ profile: 'npmm', paths: ['**'] }] });
  const checked = await hitld(['work', 'check'], root);
  assert.equal(checked.code, 1);
  assert.match(
    checked.json.problems.join('\n'),
    /ecosystems\.use\[0\]: profile npmm is unknown: not a built-in profile \(npm, .*\) or one of ecosystems\.profiles/,
  );
});

test('work check refuses a project profile that extends an unknown one or reuses a built-in name', async () => {
  const root = repo({
    profiles: [
      { name: 'mine', extends: 'rush' },
      { name: 'npm', manifests: ['package.json'] },
    ],
  });
  const checked = await hitld(['work', 'check'], root);
  assert.equal(checked.code, 1);
  const problems = checked.json.problems.join('\n');
  assert.match(problems, /profiles\[0\] mine: extends rush, which is not a built-in profile/);
  assert.match(problems, /profiles\[1\] npm: is the name of a built-in profile/);
});

test('work check refuses a version-source file that is not a repository path', async () => {
  for (const [file, why] of /** @type {[string, RegExp][]} */ ([
    ['../elsewhere/package.json', /leaves the repository root/],
    ['/etc/package.json', /is absolute/],
    ['packages/*/package.json', /is a glob, not a file/],
  ])) {
    const root = repo({
      profiles: [{ name: 'mine', version_sources: [{ file, format: 'json', key: 'version' }] }],
    });
    const checked = await hitld(['work', 'check'], root);
    assert.equal(checked.code, 1, file);
    const problems = checked.json.problems.join('\n');
    assert.match(
      problems,
      new RegExp(`version source ${file.replace(/[.*/]/g, '\\$&')} is not a repository path`),
    );
    assert.match(problems, why);
  }
});

test('work check refuses a skip folder with a separator or ..', async () => {
  for (const [folder, why] of /** @type {[string, RegExp][]} */ ([
    ['build/out', /has a path separator/],
    ['build\\out', /has a path separator/],
    ['..', /is \.\./],
  ])) {
    const root = repo({ profiles: [{ name: 'mine', extends: 'npm', skip_folders: [folder] }] });
    const checked = await hitld(['work', 'check'], root);
    assert.equal(checked.code, 1, folder);
    const problems = checked.json.problems.join('\n');
    assert.match(
      problems,
      new RegExp(`skip folder ${JSON.stringify(folder).replace(/[.\\]/g, '\\$&')}`),
    );
    assert.match(problems, why);
  }
});

test('work check refuses a cache named by a variable that runs code', async () => {
  const root = repo({
    profiles: [{ name: 'mine', caches: [{ name: 'node', variable: 'NODE_OPTIONS' }] }],
  });
  const checked = await hitld(['work', 'check'], root);
  assert.equal(checked.code, 1);
  assert.match(checked.json.problems.join('\n'), /cache node is named by NODE_OPTIONS/);
});

// --- mapping ------------------------------------------------------------------------------------

test('the most specific glob picks the profile, and a project profile extends its base', () => {
  const ecosystems = {
    use: [
      { profile: 'npm', paths: ['**'] },
      { profile: 'mine', paths: ['crates/**'] },
      { profile: 'uv', paths: ['tools/py/**'] },
    ],
    profiles: [{ name: 'mine', extends: 'cargo', skip_folders: ['target', 'out'] }],
  };
  const names = (/** @type {string} */ f) =>
    profilesOfFile(ecosystems, f).map((x) => x.profile.name);
  assert.deepEqual(names('package.json'), ['npm']);
  assert.deepEqual(names('crates/core/Cargo.toml'), ['mine']);
  assert.deepEqual(names('tools/py/pyproject.toml'), ['uv']);
  assert.deepEqual(profilesOfFile({ use: [] }, 'x'), []);
  const mine = /** @type {any} */ (resolveProfiles(ecosystems).get('mine'));
  assert.deepEqual(mine.skip_folders, ['target', 'out'], 'a given list replaces the base list');
  assert.deepEqual(mine.manifests, ['Cargo.toml'], 'a list left out is the base list');
  // Two entries whose globs are equally specific both apply: a root that is npm and Python.
  const both = profilesOfFile(
    {
      use: [
        { profile: 'npm', paths: ['**'] },
        { profile: 'uv', paths: ['**'] },
      ],
    },
    'README.md',
  );
  assert.deepEqual(
    both.map((x) => x.profile.name),
    ['npm', 'uv'],
  );
});
