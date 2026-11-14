// Actions for the security baseline's scenarios: the commit guard of design part 10.3 on a fixture
// consumer (check 5 of "One signal end to end", part 21: a commit adding a confidential file to a
// public repository is refused). Every repository is built inside the sandbox.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { main } from '../../cli/main.mjs';
import { ownCheckout } from '../../install/install.mjs';
import { chooseNamed } from '../../merge/owner.mjs';
import { runMergeQueue } from '../../merge/queue.mjs';
import { loadPolicy } from '../../policy/policy.mjs';
import { loadTrackerConfig } from '../../tracker/files/config.mjs';
import { rulesFrom } from '../../guard/classification.mjs';
import { buildConsumer, commitAll, fixtureGit, putFiles } from '../orchestrator-fixtures.mjs';

const LEAK = 'notes/partner-plan.md';
const LEAK_TEXT =
  '---\ntitle: Partner plan\nclassification: confidential\n---\n\nNot for the public.\n';

/**
 * Run hitld in the repository. @param {string[]} argv @param {string} cwd @param {string} data
 * @returns {Promise<{ exit: number, result: Record<string, any> }>}
 */
async function hitld(argv, cwd, data) {
  let out = '';
  const exit = await main(argv, {
    out: (t) => (out += t),
    err: () => {},
    cwd,
    env: { PATH: process.env.PATH, XDG_DATA_HOME: data },
  });
  try {
    return { exit, result: JSON.parse(out) };
  } catch {
    return { exit, result: { text: out } };
  }
}

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'security.commit-guard': {
    description: `Build a fixture consumer with a public ceiling, run hitld install, and try to commit a confidential file (${LEAK}) on a branch: first through the pre-commit hook, then with --no-verify. Then merge that branch in owner mode (the owner names it) and in queue mode, and run hitld work check on the branch. Returns what each one did.`,
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: async (_input, ctx) => {
      const root = buildConsumer(join(ctx.sandbox, 'guard-repo'));
      const data = join(ctx.sandbox, 'guard-data');
      const installed = await hitld(
        ['install', '--marketplace', String(ownCheckout())],
        root,
        data,
      );
      commitAll(root, 'install hitld');

      const branch = 'hitld/W-1-leak';
      fixtureGit(root, 'switch', '-q', '-c', branch);
      putFiles(root, { [LEAK]: LEAK_TEXT });
      fixtureGit(root, 'add', '-A');
      const hooked = spawnSync('git', ['commit', '-q', '-m', 'add the plan'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
      });
      const hookOutput = `${hooked.stdout}${hooked.stderr}`;
      fixtureGit(root, 'commit', '-q', '--no-verify', '-m', 'add the plan, skipping the hook');
      const check = await hitld(['work', 'check'], root, data);
      fixtureGit(root, 'switch', '-q', 'main');

      const loaded = loadPolicy({ cwd: root });
      const tracker = loadTrackerConfig({ repoRoot: root });
      if (!loaded.policy || !tracker.config) throw new Error('the fixture consumer is invalid');
      const settings = {
        mainBranch: 'main',
        batchMax: 4,
        fastChecks: [],
        fullSuite: ["node --test 'test/*.test.js'"],
        generated: [],
        flakeReruns: 0,
        classification: rulesFrom(loaded.policy, tracker.config.default_classification),
      };
      const entries = [{ item: 'W-1', branch }];
      const before = fixtureGit(root, 'rev-parse', 'main');
      const owner = await runMergeQueue({
        repoRoot: root,
        entries: chooseNamed(entries, [branch]).chosen,
        settings,
      });
      const queue = await runMergeQueue({ repoRoot: root, entries, settings });
      ctx.recordTokens(0);
      return {
        hook: installed.result.done?.commit_guard ?? null,
        hook_refused: hooked.status !== 0,
        hook_names_file: hookOutput.includes(LEAK),
        hook_names_rule:
          hookOutput.includes('above the repository') && hookOutput.includes('ceiling'),
        owner: owner.rejected.map((x) => ({
          item: x.item,
          reason: x.reason,
          files: x.files ?? [],
        })),
        queue: queue.rejected.map((x) => ({
          item: x.item,
          reason: x.reason,
          files: x.files ?? [],
        })),
        merged: [...owner.merged, ...queue.merged].map((m) => m.item),
        main_moved: fixtureGit(root, 'rev-parse', 'main') !== before,
        work_check_ok: check.result.ok === true,
        work_check_problems: check.result.problems ?? [],
      };
    },
  },
};
