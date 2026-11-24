// Ecosystem profiles (HITLD-920): the built-in profiles are data that can never run anything, the
// policy.json `ecosystems` section maps profiles to paths explicitly and holds the only commands,
// and `hitld work check` refuses an unknown profile, a version-source file that is not a
// repository path and a skip folder with a separator or `..`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import {
  BUILTIN_PROFILES_FILE,
  KNOWN_CACHE_VARIABLES,
  builtinProblems,
  builtinProfiles,
  cacheVariableProblem,
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

/**
 * A fixture repository whose policy.json has this ecosystems section.
 * @param {unknown} ecosystems @param {Record<string, string>} [files]
 */
function repo(ecosystems, files = {}) {
  const root = makeRepo({
    files: {
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'fixture', key: 'W' },
        ecosystems,
      }),
      ...files,
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
    assert.ok(problems.includes(`profiles[0].${key} `), `${key}: ${problems}`);
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
    ['../elsewhere/package.json', /has a \.\. segment/],
    ['/etc/package.json', /is absolute/],
    ['packages/*/package.json', /is a glob, not a file/],
    ['packages/../package.json', /has a \.\. segment/],
    ['a/b/../../package.json', /has a \.\. segment/],
    ['~/package.json', /starts with ~/],
  ])) {
    const root = repo({
      profiles: [{ name: 'mine', version_sources: [{ file, format: 'json', key: 'version' }] }],
    });
    const checked = await hitld(['work', 'check'], root);
    assert.equal(checked.code, 1, file);
    const problems = checked.json.problems.join('\n');
    assert.ok(problems.includes(`version source ${file} is not a repository path`), problems);
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
    assert.ok(problems.includes(`skip folder ${JSON.stringify(folder)}`), problems);
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

// The variables the owner's review named, and each is refused through work check itself.
const NAMED_CODE_VARIABLES = [
  'npm_config_init_module',
  'COMPOSER_HOME',
  'HOME',
  'GOFLAGS',
  'GOENV',
  'RUSTFLAGS',
  'PIP_CONFIG_FILE',
  'BUNDLE_APP_CONFIG',
];

/** @type {Promise<{ code: number, json: any }> | undefined} */
let namedChecked;
const checkNamed = () =>
  (namedChecked ??= hitld(
    ['work', 'check'],
    repo({
      profiles: [
        {
          name: 'mine',
          caches: NAMED_CODE_VARIABLES.map((variable, i) => ({ name: `c${i}`, variable })),
        },
      ],
    }),
  ));

for (const [i, variable] of NAMED_CODE_VARIABLES.entries()) {
  test(`work check refuses ${variable} as a cache variable`, async () => {
    const checked = await checkNamed();
    assert.equal(checked.code, 1);
    const line = checked.json.problems.find((/** @type {string} */ p) =>
      p.includes(`cache c${i} is named by ${variable}, which is `),
    );
    assert.ok(line, checked.json.problems.join('\n'));
    assert.match(line, /a cache variable must name only a cache folder/);
  });
}

// Added beyond the review's list: each tool namespace's other settings, variables any tool reads
// as a home, configuration, shell, compiler or flags, and names that end as such variables do.
for (const variable of [
  'npm_config_userconfig',
  'NPM_CONFIG_ONLOAD_SCRIPT',
  'npm_config_script_shell',
  'PNPM_HOME',
  'YARN_YARN_PATH',
  'YARN_RC_FILENAME',
  'NODE_OPTIONS',
  'CARGO_HOME',
  'CARGO_BUILD_RUSTC_WRAPPER',
  'RUSTC_WRAPPER',
  'RUSTUP_TOOLCHAIN',
  'GOPATH',
  'GOROOT',
  'GOTOOLCHAIN',
  'GOPROXY',
  'CGO_CFLAGS',
  'PIP_INDEX_URL',
  'UV_CONFIG_FILE',
  'UV_PYTHON_INSTALL_DIR',
  'POETRY_HOME',
  'POETRY_CONFIG_DIR',
  'PYTHONPATH',
  'PYTHONUSERBASE',
  'VIRTUAL_ENV',
  'MAVEN_OPTS',
  'MAVEN_ARGS',
  'M2_HOME',
  'GRADLE_USER_HOME',
  'GRADLE_OPTS',
  'JAVA_HOME',
  'JAVA_TOOL_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'BUNDLE_GEMFILE',
  'BUNDLE_USER_CONFIG',
  'GEM_HOME',
  'RUBYOPT',
  'COMPOSER',
  'COMPOSER_VENDOR_DIR',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'XDG_CONFIG_HOME',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'GIT_SSH_COMMAND',
  'CC',
  'CFLAGS',
  'LDFLAGS',
  'MAKEFLAGS',
  'MYTOOL_HOME',
  'MYTOOL_CONFIG_FILE',
  'MYTOOL_FLAGS',
  'MYTOOL_OPTS',
  'MYTOOL_PATH',
]) {
  test(`work check refuses ${variable} as a cache variable (added)`, () => {
    assert.ok(cacheVariableProblem(variable), variable);
    const problems = checkEcosystems({
      profiles: [{ name: 'mine', caches: [{ name: 'c', variable }] }],
    });
    assert.equal(problems.length, 1, variable);
    assert.ok(problems[0].includes(`cache c is named by ${variable}, which is `), problems[0]);
  });
}

test('a variable that names only a cache folder is accepted', () => {
  const builtin = [...builtinProfiles().values()].flatMap((p) => p.caches.map((c) => c.variable));
  for (const variable of [...builtin, 'NPM_CONFIG_CACHE', 'MYTOOL_CACHE_DIR', 'MYTOOL_CACHE']) {
    assert.equal(cacheVariableProblem(variable), null, variable);
  }
  for (const variable of KNOWN_CACHE_VARIABLES) {
    assert.equal(cacheVariableProblem(variable), null, variable);
  }
  // Every variable a built-in profile uses is on the known list.
  for (const variable of builtin) assert.ok(KNOWN_CACHE_VARIABLES.includes(variable.toUpperCase()));
});

// The allowlist (HITLD-920 review, D-01M85XNNYCHK205F): one assertion per name the owner listed.
for (const variable of [
  'GITHUB_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'CLASSPATH',
  'DOTNET_STARTUP_HOOKS',
  'SSL_CERT_DIR',
  'OPENSSL_CONF',
  'LUA_INIT',
  'ZDOTDIR',
  'TERMINFO_DIRS',
  'NUGET_PLUGIN_PATHS',
  'HTTPS_PROXY',
  'KUBECONFIG',
  'DOCKER_HOST',
  'TMPDIR',
  'CCACHE_PREFIX',
  'CCACHE_CONFIGPATH',
  'SCCACHE_CONF',
  'SHELLOPTS',
  'IFS',
  'PS4',
  'FOO',
  '_',
  'A',
  'CARGO_HOME',
  'GRADLE_USER_HOME',
  'PRE_COMMIT_HOME',
  'HF_HOME',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'Path',
  'PASSWORD_STORE_DIR',
  'CREDENTIAL_STORE_DIR',
  'GPG_STORE_DIR',
  'SECRETS_STORE_DIR',
  'KEYRING_STORE_DIR',
]) {
  test(`the cache-variable allowlist refuses ${variable}`, () => {
    assert.match(String(cacheVariableProblem(variable)), /^not a known cache variable/);
  });
}

for (const variable of [
  'XDG_CACHE_HOME',
  'PNPM_STORE_DIR',
  'UV_PYTHON_CACHE_DIR',
  'GRADLE_RO_DEP_CACHE',
  'CARGO_REGISTRIES_CACHE',
  'PYTHONPYCACHEPREFIX',
  'MYTOOL_CACHE',
  'MYTOOL_CACHE_DIR',
  'MYTOOL_CACHE_FOLDER',
]) {
  test(`the cache-variable allowlist accepts ${variable}`, () => {
    assert.equal(cacheVariableProblem(variable), null);
  });
}

// A cache suffix does not admit a name whose other words name a credential, a setting or code.
for (const [variable, word] of [
  ['AWS_SHARED_CREDENTIALS_CACHE', 'AWS'],
  ['SHARED_CREDENTIALS_CACHE', 'CREDENTIAL'],
  ['NPM_TOKEN_CACHE', 'TOKEN'],
  ['GNUPGHOME_CACHE', 'GNUPG'],
  ['NODE_OPTIONS_CACHE_DIR', 'OPTIONS'],
  ['PATH_CACHE', 'PATH'],
  ['HOME_CACHE', 'HOME'],
  ['MY_PASSWORD_CACHE', 'PASSWORD'],
  ['MY_PASSWD_CACHE_DIR', 'PASSWD'],
  ['VAULT_SECRET_CACHE', 'VAULT'],
  ['MY_SECRET_CACHE', 'SECRET'],
  ['API_KEY_CACHE', 'KEY'],
  ['GPG_CACHE', 'GPG'],
  ['SSH_AGENT_CACHE', 'SSH'],
  ['LIB_PRELOAD_CACHE', 'PRELOAD'],
]) {
  test(`the cache-variable allowlist refuses ${variable} for ${word}`, () => {
    assert.equal(
      cacheVariableProblem(variable),
      `named for ${word}, a credential, a session, a setting, shell start-up or code, not a cache`,
    );
  });
}

// HITLD-1019: credential, session, setting and shell start-up words, one test per word, each
// before the suffix as a whole word and in each suffix's form.
for (const word of [
  'AUTH',
  'SESSION',
  'COOKIE',
  'PRIVATE',
  'CERT',
  'PASS',
  'PWD',
  'VAULT',
  'NETRC',
  'OAUTH',
  'JWT',
  'BEARER',
  'KRB',
  'KERBEROS',
  'SUDO',
  'ASKPASS',
  'CONFIG',
  'ENV',
  'SHELL',
  'BASH',
  'ZSH',
]) {
  test(`the cache-variable allowlist refuses a name with ${word} before the suffix`, () => {
    const why = `named for ${word}, a credential, a session, a setting, shell start-up or code, not a cache`;
    for (const variable of [
      `${word}_CACHE`,
      `MYTOOL_${word}_CACHE_DIR`,
      `MYTOOL_${word}_STORE_CACHE_FOLDER`,
      `${word.toLowerCase()}_cache`,
    ]) {
      assert.equal(cacheVariableProblem(variable), why, variable);
    }
    const problems = checkEcosystems({
      profiles: [{ name: 'mine', caches: [{ name: 'c', variable: `MYTOOL_${word}_CACHE` }] }],
    });
    assert.equal(problems.length, 1, word);
  });
}

test('the cache-variable allowlist refuses ZSH_CACHE_DIR, which zsh sources at start-up', () => {
  assert.equal(
    cacheVariableProblem('ZSH_CACHE_DIR'),
    'named for ZSH, a credential, a session, a setting, shell start-up or code, not a cache',
  );
  assert.ok(cacheVariableProblem('zsh_cache_dir'));
});

// The GitHub Actions runner puts what RUNNER_TOOL_CACHE holds on the PATH of later steps.
for (const variable of [
  'RUNNER_TOOL_CACHE',
  'runner_tool_cache',
  'RUNNER_TEMP_CACHE_DIR',
  'RUNNER_CACHE',
]) {
  test(`the cache-variable allowlist refuses the runner variable ${variable}`, () => {
    assert.equal(
      cacheVariableProblem(variable),
      'read by the GitHub Actions runner, which puts what it caches on the PATH of later steps',
    );
  });
}

test('the cache-variable allowlist still accepts PIPENV_CACHE_DIR, though PIPENV holds ENV', () => {
  assert.equal(cacheVariableProblem('PIPENV_CACHE_DIR'), null);
  assert.equal(cacheVariableProblem('pipenv_cache_dir'), null);
  assert.ok(cacheVariableProblem('MYENV_CACHE_DIR'));
});

// A switch word counts at the start, the end and between underscores.
for (const [variable, word] of [
  ['NO_CACHE', 'NO'],
  ['DISABLE_CACHE', 'DISABLE'],
  ['SKIP_CACHE', 'SKIP'],
  ['USE_CACHE', 'USE'],
  ['ENABLE_CACHE', 'ENABLE'],
  ['YARN_ENABLE_GLOBAL_CACHE', 'ENABLE'],
  ['TOOL_NO_CACHE_DIR', 'NO'],
  ['ENABLED_CACHE', 'ENABLED'],
  ['MYTOOL_DISABLED_CACHE_DIR', 'DISABLED'],
  ['MYTOOL_OFFLINE_CACHE', 'OFFLINE'],
  ['FORCE_CACHE_FOLDER', 'FORCE'],
  ['mytool_force_cache', 'FORCE'],
]) {
  test(`the cache-variable allowlist refuses the switch ${variable}`, () => {
    assert.equal(cacheVariableProblem(variable), `a switch (${word}), not a folder`);
  });
}

test('the cache-variable allowlist compares without case, and refuses a non-ASCII name', () => {
  assert.equal(cacheVariableProblem('xdg_cache_home'), null);
  assert.equal(cacheVariableProblem('Npm_Config_Cache'), null);
  assert.equal(cacheVariableProblem('npm_config_store_dir'), null);
  assert.match(String(cacheVariableProblem('path')), /^not a known cache variable/);
  assert.match(String(cacheVariableProblem('github_token')), /^not a known cache variable/);
  // Fullwidth PATH: never folded to PATH, and refused as not a plain name.
  assert.match(String(cacheVariableProblem('\uFF30\uFF21\uFF34\uFF28')), /not a plain ASCII/);
  assert.match(String(cacheVariableProblem('\uFF30\uFF21\uFF34\uFF28_CACHE')), /not a plain ASCII/);
});

test('a cache suffix does not admit a loader, git or switch variable', () => {
  assert.match(String(cacheVariableProblem('DYLD_SHARED_CACHE_DIR')), /dynamic loader or git/);
  assert.match(String(cacheVariableProblem('LD_CACHE')), /dynamic loader or git/);
  assert.match(String(cacheVariableProblem('GIT_OBJECT_CACHE_DIR')), /dynamic loader or git/);
  assert.match(String(cacheVariableProblem('YARN_ENABLE_GLOBAL_CACHE')), /a switch/);
  assert.match(String(cacheVariableProblem('PASSWORD_STORE_DIR')), /^not a known cache variable/);
});

test('work check refuses a use glob that can never match, or names no file in the checkout', async () => {
  const root = repo(
    {
      use: [
        {
          profile: 'npm',
          paths: [
            'web',
            'web/',
            'web\\**',
            'web/../api/**',
            '~/src/**',
            'lib',
            'link',
            'Cargo.toml',
            'file-link',
            'web/**',
            'package.json',
          ],
        },
      ],
    },
    { 'web/index.js': 'x\n', 'package.json': '{}\n' },
  );
  symlinkSync('web', join(root, 'link'));
  symlinkSync('package.json', join(root, 'file-link'));
  const checked = await hitld(['work', 'check'], root);
  assert.equal(checked.code, 1);
  const problems = checked.json.problems.filter((/** @type {string} */ p) =>
    p.includes('ecosystems.use[0]'),
  );
  const about = (/** @type {string} */ glob) =>
    problems.find((/** @type {string} */ p) => p.includes(`path ${JSON.stringify(glob)} `)) ?? '';
  assert.match(about('web'), /is a folder; .*for a folder write web\/\*\*/);
  assert.match(about('web/'), /ends with \/, which matches nothing; write web\/\*\*/);
  assert.match(about('web\\**'), /has a backslash/);
  assert.match(about('web/../api/**'), /has a \.\. segment/);
  assert.match(about('~/src/**'), /starts with ~/);
  assert.match(about('lib'), /names no file in the checkout; .*for a folder write lib\/\*\*/);
  assert.match(about('link'), /symbolic link.*for a folder write link\/\*\*/);
  assert.match(about('Cargo.toml'), /names no file in the checkout/, 'a missing file');
  assert.match(about('file-link'), /symbolic link/, 'a symbolic link to a file');
  assert.equal(about('web/**'), '', 'a folder glob passes');
  assert.equal(about('package.json'), '', 'a file passes');
  assert.equal(problems.length, 9, problems.join('\n'));
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
