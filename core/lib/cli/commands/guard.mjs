// The commit guard (design part 10.2 and 10.3): the classification check the pre-commit hook runs.
// The rule itself is in core/lib/guard/classification.mjs; the merge queue and `hitld work check`
// use the same one.

import { spawnSync } from 'node:child_process';
import { POLICY_PATH, loadPolicy } from '../../policy/policy.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import { loadTrackerConfig } from '../../tracker/files/config.mjs';
import { checkStaged, checkTree, problemLines, rulesFrom } from '../../guard/classification.mjs';

/**
 * What a refusal says: files above the ceiling, and files that hold the private store's address or
 * device list, each with where it goes.
 * @param {import('../../guard/classification.mjs').Refused[]} refused @param {string} ceiling
 */
function refusedMessage(refused, ceiling) {
  const placed = refused.filter((r) => r.rule === 'store-address' || r.rule === 'store-devices');
  const above = refused.length - placed.length;
  const parts = [];
  if (above) {
    parts.push(
      `${above} file(s) above the repository's classification ceiling "${ceiling}" (design part 10.3). Keep them in the private store; lowering a classification is the owner's decision`,
    );
  }
  if (placed.length) {
    parts.push(
      `${placed.length} file(s) hold the private store's address or device list, which never go in the project's repository (design 0003); each problem says where it goes`,
    );
  }
  return `refused: ${parts.join('. ')}`;
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'check classification',
    summary:
      "The commit guard: refuse files above the repository's classification ceiling, naming the file and the rule. --staged checks the next commit (the pre-commit hook); without it, the whole tree",
    built_by: 'first-release',
    args: [
      {
        name: 'staged',
        type: 'boolean',
        description:
          'Check only the files staged for the next commit, as the index holds them. The pre-commit hook hitld install writes runs this',
      },
    ],
    run: (input, ctx) => {
      const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: ctx.cwd,
        encoding: 'utf8',
      });
      if (top.status !== 0) {
        return {
          ok: false,
          error: 'not-a-repository',
          message: `${ctx.cwd} is not in a git repository`,
        };
      }
      const root = top.stdout.trim();
      /** @type {string[]} */
      const warnings = [];
      const loaded = loadPolicy({ cwd: root });
      /** @type {Record<string, any> | null} */
      let policy = loaded.policy;
      if (!policy) {
        // No policy.json at all: the strictest rules. One that exists but cannot be trusted or
        // read refuses, so a broken policy never opens the guard.
        if (loaded.path) {
          return {
            ok: false,
            error: 'policy',
            message: `${POLICY_PATH}: ${formatErrors(loaded.errors).split('\n').join('; ')}; nothing is committed until it is fixed`,
          };
        }
        warnings.push(`no ${POLICY_PATH}: the ceiling is public and unclassified files are public`);
        policy = { project: {} }; // rulesFrom fills in the strictest rules
      }
      const tracker = loadTrackerConfig({ repoRoot: root });
      if (!tracker.config) {
        return {
          ok: false,
          error: 'tracker',
          message: `tracker.json: ${tracker.errors.map((e) => `${e.path} ${e.message}`).join('; ')}; nothing is committed until it is fixed`,
        };
      }
      const rules = rulesFrom(policy, tracker.config.default_classification);
      const r = input.staged === true ? checkStaged(root, rules) : checkTree(root, rules);
      const problems = problemLines(r.refused);
      return {
        ok: r.refused.length === 0,
        scope: input.staged === true ? 'staged' : 'tree',
        ceiling: rules.ceiling,
        files: r.files,
        refused: r.refused,
        problems,
        ...(warnings.length ? { warnings } : {}),
        message: r.refused.length
          ? refusedMessage(r.refused, rules.ceiling)
          : `${r.files} file(s), none above the ceiling "${rules.ceiling}"`,
      };
    },
  },
];
