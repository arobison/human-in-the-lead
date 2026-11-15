// Synthetic fixture repositories for scenarios (design part 17.2): small, seeded, public, and
// copied fresh into a sandbox for every run. Nothing here comes from a consuming project.
//
// Generators are named in a scenario's `fixture.generator`:
//   repo  a small repository in JavaScript or Python with tests, a policy.json and an area map
//   copy  a copy of evals/fixtures/<options.from> from the scenario's evals directory

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { isObject, seededRandom, seededShuffle, sandboxPath, writeSandboxFile } from './util.mjs';

/**
 * @typedef {object} Fixture
 * @property {string} dir the sandbox directory
 * @property {string[]} files the files written, relative to dir, sorted
 * @property {{ id: string, key: string } | null} project from the generated policy.json
 * @property {string | null} commit the commit, when the repository is a real git one
 */

const NOUNS = ['cache', 'parser', 'queue', 'index', 'router', 'ledger', 'codec', 'matrix'];
const VERBS = ['merge', 'scale', 'clamp', 'join', 'rank', 'pack', 'trim', 'fold'];

/** Fixed identity and dates, so a fixture's commit hash is the same everywhere. */
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Eval Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Eval Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

/** @param {string} dir @param {string[]} args */
const git = (dir, args) =>
  execFileSync('git', ['-C', dir, ...args], {
    env: { PATH: process.env.PATH ?? '', ...GIT_ENV },
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  }).trim();

/**
 * The `repo` generator.
 * @param {string} dir an existing empty directory
 * @param {{ seed: number, options: Record<string, unknown> }} request
 *   options: language ("javascript" or "python", default javascript), modules (1 to 8, default 2),
 *   git (a real repository with one commit; default false), policy (data merged into policy.json's
 *   project section's sibling sections, for example { "execution": { "max_executors": { ... } } })
 * @returns {Fixture}
 */
function generateRepo(dir, { seed, options }) {
  const language = options.language ?? 'javascript';
  if (language !== 'javascript' && language !== 'python') {
    throw new Error(`fixture repo: language must be "javascript" or "python", not ${language}`);
  }
  const count = options.modules ?? 2;
  if (
    !Number.isInteger(count) ||
    /** @type {number} */ (count) < 1 ||
    /** @type {number} */ (count) > 8
  ) {
    throw new Error('fixture repo: modules must be an integer from 1 to 8');
  }
  const rand = seededRandom(seed);
  const pick = (/** @type {string[]} */ list) => list[Math.floor(rand() * list.length)];
  const nouns = seededShuffle(NOUNS, seed).slice(0, /** @type {number} */ (count));
  /** @type {string[]} */
  const files = [];
  /** @param {string} rel @param {string} text */
  const put = (rel, text) => {
    writeSandboxFile(sandboxPath(dir, rel), text);
    files.push(rel);
  };

  const project = { id: 'fixture-repo', key: 'FX' };
  const policy = {
    schema_version: 1,
    project,
    ...(isObject(options.policy) ? options.policy : {}),
  };
  put('.human-in-the-lead/policy.json', `${JSON.stringify(policy, null, 2)}\n`);
  put(
    'README.md',
    `# ${project.id}\n\nA synthetic repository generated for the eval suite (seed ${seed}). It is not real code.\n`,
  );
  put(
    'docs/areas.json',
    `${JSON.stringify(
      nouns.map((n) => ({ name: n, paths: [`src/${n}.*`, `test/*${n}*`] })),
      null,
      2,
    )}\n`,
  );

  if (language === 'javascript') {
    put(
      'package.json',
      `${JSON.stringify({ name: project.id, private: true, type: 'module' }, null, 2)}\n`,
    );
  }
  for (const noun of nouns) {
    const verb = pick(VERBS);
    const k = 1 + Math.floor(rand() * 9);
    if (language === 'javascript') {
      put(
        `src/${noun}.js`,
        `// The ${noun}: ${verb} a number with a fixed step.\nexport function ${verb}(x) {\n  return x + ${k};\n}\n`,
      );
      put(
        `test/${noun}.test.js`,
        `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${verb} } from '../src/${noun}.js';\n\ntest('${verb} adds ${k}', () => {\n  assert.equal(${verb}(1), ${1 + k});\n});\n`,
      );
    } else {
      put(
        `src/${noun}.py`,
        `"""The ${noun}: ${verb} a number with a fixed step."""\n\n\ndef ${verb}(x):\n    return x + ${k}\n`,
      );
      put(
        `test/test_${noun}.py`,
        `from src.${noun} import ${verb}\n\n\ndef test_${verb}():\n    assert ${verb}(1) == ${1 + k}\n`,
      );
    }
  }

  /** @type {string | null} */
  let commit = null;
  if (options.git) {
    git(dir, ['init', '--quiet', '--initial-branch=main']);
    git(dir, ['add', '--all']);
    git(dir, ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--message', 'fixture']);
    commit = git(dir, ['rev-parse', 'HEAD']);
  }
  return { dir, files: files.sort(), project, commit };
}

/**
 * The `copy` generator: a fresh copy of evals/fixtures/<from>.
 * @param {string} dir @param {{ options: Record<string, unknown>, evalsDir: string }} request
 * @returns {Fixture}
 */
function copyFixture(dir, { options, evalsDir }) {
  const from = options.from;
  if (typeof from !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(from)) {
    throw new Error('fixture copy: options.from must name a directory in evals/fixtures/');
  }
  const root = resolve(evalsDir, 'fixtures');
  const source = resolve(root, from);
  if (!source.startsWith(root + sep) || !existsSync(source)) {
    throw new Error(`fixture copy: evals/fixtures/${from} is not a directory`);
  }
  // A fixture is plain files and directories: a symbolic link could point anywhere, so any link
  // (including the fixture directory itself) is refused, not followed or copied.
  if (
    lstatSync(root).isSymbolicLink() ||
    !lstatSync(source).isDirectory() ||
    realpathSync(source) !== resolve(realpathSync(root), from)
  ) {
    throw new Error(
      `fixture copy: evals/fixtures/${from} is not a directory, or is a symbolic link`,
    );
  }
  /** @type {string[]} */
  const files = [];
  /** @param {string} d @param {string} prefix */
  const walk = (d, prefix) => {
    for (const name of readdirSync(d)) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = lstatSync(join(d, name));
      if (st.isSymbolicLink()) {
        throw new Error(
          `fixture copy: evals/fixtures/${from}/${rel} is a symbolic link; fixtures hold plain files only`,
        );
      }
      if (st.isFile() && st.nlink > 1) {
        throw new Error(
          `fixture copy: evals/fixtures/${from}/${rel} is a hard link; fixtures hold plain files only`,
        );
      }
      if (st.isDirectory()) walk(join(d, name), rel);
      else if (st.isFile()) files.push(rel);
      else
        throw new Error(
          `fixture copy: evals/fixtures/${from}/${rel} is not a plain file or directory`,
        );
    }
  };
  walk(source, '');
  // The filter repeats the check at copy time, so a link added after the walk is not copied.
  cpSync(source, dir, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const st = lstatSync(src);
      return !st.isSymbolicLink() && !(st.isFile() && st.nlink > 1);
    },
  });
  return { dir, files: files.sort(), project: null, commit: null };
}

export const GENERATORS = Object.freeze({ repo: generateRepo, copy: copyFixture });

/**
 * Build a fixture in an empty sandbox directory.
 * @param {string} dir
 * @param {{ generator: string, options?: Record<string, unknown> }} spec
 * @param {{ seed: number, evalsDir: string }} context seed: the scenario's fixture seed
 * @returns {Fixture}
 */
export function buildFixture(dir, spec, context) {
  mkdirSync(dir, { recursive: true });
  const options = spec.options ?? {};
  if (spec.generator === 'repo') return generateRepo(dir, { seed: context.seed, options });
  if (spec.generator === 'copy') return copyFixture(dir, { options, evalsDir: context.evalsDir });
  throw new Error(
    `unknown fixture generator "${spec.generator}" (known: ${Object.keys(GENERATORS).join(', ')})`,
  );
}
