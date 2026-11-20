// Actions for the adversarial loop's scenarios (design 6.3 and 17.1): a fixture area with five
// seeded bugs and three clean controls (adversary-fixtures.mjs), hitld run in its repository, and
// a look at what the pass left behind: commits, fix items, regression tests and the suite.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../cli/main.mjs';
import { readRegression } from '../../adversary/regression.mjs';
import { parseItem } from '../../tracker/files/frontmatter.mjs';
import { buildAdversaryRepo, VARIANTS } from '../adversary-fixtures.mjs';
import { fixtureGit } from '../orchestrator-fixtures.mjs';

/** @param {string} sandbox */
const repoOf = (sandbox) => join(sandbox, 'adversary-repo');

/** Run node --test on paths in the repository. @param {string} root @param {string[]} paths */
function suite(root, paths) {
  const r = spawnSync(process.execPath, ['--test', ...paths], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    timeout: 120_000,
  });
  return r.status === 0;
}

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'adversary.repo': {
    description: `Build the fixture area's repository: main holds the clean area (src/text.js with its invariant registry and example tests), and a branch with one variant checked out. Variants: ${Object.keys(VARIANTS).join(', ')}. Returns the branch, the invariant the variant breaks (null for a clean control) and whether the example tests pass on it.`,
    input: {
      type: 'object',
      properties: { variant: { enum: Object.keys(VARIANTS) } },
      required: ['variant'],
      additionalProperties: false,
    },
    run: ({ variant }, ctx) => {
      const v = /** @type {keyof typeof VARIANTS} */ (variant);
      const { root, branch } = buildAdversaryRepo(repoOf(ctx.sandbox), v);
      return {
        branch,
        breaks: VARIANTS[v].breaks,
        examples_pass: suite(root, ['test/**/*.test.js']),
      };
    },
  },
  'adversary.hitld': {
    description:
      "Run a hitld command in the fixture area's repository, with the sandbox as its data home. Returns { exit, result }.",
    input: {
      type: 'object',
      properties: { argv: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      required: ['argv'],
      additionalProperties: false,
    },
    run: async ({ argv }, ctx) => {
      let out = '';
      const exit = await main(/** @type {string[]} */ (argv), {
        out: (t) => (out += t),
        err: () => {},
        cwd: repoOf(ctx.sandbox),
        env: {
          PATH: process.env.PATH,
          HOME: join(ctx.sandbox, 'home'),
          XDG_DATA_HOME: join(ctx.sandbox, 'data'),
        },
      });
      try {
        return { exit, result: JSON.parse(out) };
      } catch {
        return { exit, result: { text: out } };
      }
    },
  },
  'adversary.merge': {
    description:
      "Stand in for the owner's merge: switch the fixture area's repository to main and merge the variant's branch into it. Returns the branch merged.",
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (_input, ctx) => {
      const root = repoOf(ctx.sandbox);
      const branch = fixtureGit(root, 'symbolic-ref', '--short', 'HEAD').trim();
      fixtureGit(root, 'switch', '-q', 'main');
      fixtureGit(root, 'merge', '-q', '--no-ff', '-m', `Merge ${branch}`, branch);
      return { merged: branch };
    },
  },
  'adversary.inspect': {
    description:
      "What the pass left in the fixture area's repository: the commits since main with the files each changed, the items it added under work/items with their state, the regression tests under test/adversary with their todo marks, and whether the whole suite passes.",
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (_input, ctx) => {
      const root = repoOf(ctx.sandbox);
      const commits = fixtureGit(
        root,
        'log',
        '--no-merges',
        '--format=%H %s',
        'main-at-start..HEAD',
      )
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha, ...subject] = line.split(' ');
          const files = fixtureGit(root, 'show', '--name-only', '--format=', sha)
            .trim()
            .split('\n')
            .filter(Boolean);
          return { subject: subject.join(' '), files };
        });
      // The items the pass added: those not in the fixture as it started.
      const items = fixtureGit(root, 'diff', '--name-only', 'main-at-start', '--', 'work/items')
        .trim()
        .split('\n')
        .filter(Boolean)
        .sort()
        .map((file) => {
          const { data } = parseItem(readFileSync(join(root, file), 'utf8'));
          return { file, id: data?.id, state: data?.state, title: data?.title };
        });
      const dir = join(root, 'test/adversary');
      const tests = existsSync(dir)
        ? readdirSync(dir)
            .sort()
            .map((f) => {
              const r = readRegression(readFileSync(join(dir, f), 'utf8'));
              return {
                file: `test/adversary/${f}`,
                todo: Boolean(r?.todo),
                todo_mark: r?.todo ?? null,
              };
            })
        : [];
      const status = fixtureGit(root, 'status', '--porcelain').trim();
      return {
        commits,
        items,
        tests,
        clean_tree: status === '',
        suite_passes: suite(root, ['test/**/*.test.js']),
      };
    },
  },
};
