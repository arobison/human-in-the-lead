// The commit guard (design part 10.2 and 10.3): the classification check the pre-commit hook runs,
// and the commit message check the commit-msg hook runs. The rules themselves are in
// core/lib/guard/; the merge queue and `hitld work check` use the same ones. Both hooks read the
// private term list from the private store; neither ever prints a term.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POLICY_PATH, loadPolicy } from '../../policy/policy.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import { loadTrackerConfig } from '../../tracker/files/config.mjs';
import {
  checkStaged,
  checkTree,
  isTermRefusal,
  problemLines,
  rulesFrom,
} from '../../guard/classification.mjs';
import { commitMessageText, findTerms, matchMessage } from '../../guard/private-terms.mjs';
import { termsForProject } from '../../store/private-terms.mjs';

/**
 * What a refusal says: files above the ceiling, files that hold the private store's address or
 * device list, and files that hold a private term, each with where it goes.
 * @param {import('../../guard/classification.mjs').Refused[]} refused @param {string} ceiling
 */
function refusedMessage(refused, ceiling) {
  const placed = refused.filter((r) => r.rule === 'store-address' || r.rule === 'store-devices');
  const termed = refused.filter(isTermRefusal);
  const above = refused.length - placed.length - termed.length;
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
  if (termed.length) {
    parts.push(
      `${termed.length} file(s) hold a term from the private term list (design part 10.3, rule 7); each problem names its kind and line. Refer to it by its role instead`,
    );
  }
  return `refused: ${parts.join('. ')}`;
}

/** @param {string} cwd */
function repoRoot(cwd) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return top.status === 0 ? top.stdout.trim() : null;
}

/**
 * The private terms for the repository at root: from the store its policy's project ID names. A
 * list that does not read refuses (the check fails closed).
 * @param {string} root @param {Record<string, any> | null} policy
 * @param {import('../table.mjs').CommandContext} ctx
 * @returns {ReturnType<typeof termsForProject> | { ok: false, error: string, message: string }}
 */
function terms(root, policy, ctx) {
  try {
    return termsForProject({ policy, env: ctx.env, repoRoot: root });
  } catch (e) {
    const err = /** @type {{ code?: unknown, message: string }} */ (e);
    if (err.code === 'private-list-invalid') {
      return { ok: false, error: 'private-list-invalid', message: err.message };
    }
    throw e;
  }
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'check classification',
    summary:
      "The commit guard: refuse files above the repository's classification ceiling, and files that hold a term from the private term list, naming the file and the rule (a term by its kind and line, never itself). --staged checks the next commit (the pre-commit hook); without it, the whole tree",
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
      const root = repoRoot(ctx.cwd);
      if (!root) {
        return {
          ok: false,
          error: 'not-a-repository',
          message: `${ctx.cwd} is not in a git repository`,
        };
      }
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
      const t = terms(root, loaded.policy, ctx);
      if ('ok' in t)
        return { ...t, message: `${t.message}; nothing is committed until it is fixed` };
      warnings.push(...t.warnings);
      const rules = {
        ...rulesFrom(policy, tracker.config.default_classification),
        terms: t.matchers,
      };
      const r = input.staged === true ? checkStaged(root, rules) : checkTree(root, rules);
      const problems = problemLines(r.refused);
      return {
        ok: r.refused.length === 0,
        scope: input.staged === true ? 'staged' : 'tree',
        ceiling: rules.ceiling,
        files: r.files,
        private_terms: t.matchers.length,
        refused: r.refused,
        problems,
        ...(warnings.length ? { warnings } : {}),
        message: r.refused.length
          ? refusedMessage(r.refused, rules.ceiling)
          : `${r.files} file(s), none above the ceiling "${rules.ceiling}" and none with a private term`,
      };
    },
  },
  {
    name: 'check commit-message',
    summary:
      'The commit message guard: refuse a commit message that holds a term from the private term list, naming its kind and line, never the term. The commit-msg hook hitld install writes runs this',
    built_by: 'first-release',
    args: [
      {
        name: 'file',
        type: 'string',
        positional: true,
        required: true,
        description:
          'The file that holds the message, as git gives it to the commit-msg hook. Comment lines, and the diff after a scissors line, are not checked: git leaves them out',
      },
    ],
    run: (input, ctx) => {
      const root = repoRoot(ctx.cwd);
      if (!root) {
        return {
          ok: false,
          error: 'not-a-repository',
          message: `${ctx.cwd} is not in a git repository`,
        };
      }
      const loaded = loadPolicy({ cwd: root });
      if (!loaded.policy && loaded.path) {
        return {
          ok: false,
          error: 'policy',
          message: `${POLICY_PATH}: ${formatErrors(loaded.errors).split('\n').join('; ')}; nothing is committed until it is fixed`,
        };
      }
      const t = terms(root, loaded.policy, ctx);
      if ('ok' in t)
        return { ...t, message: `${t.message}; nothing is committed until it is fixed` };
      const char = spawnSync('git', ['config', '--get', 'core.commentChar'], {
        cwd: root,
        encoding: 'utf8',
      }).stdout?.trim();
      const text = commitMessageText(
        readFileSync(resolve(ctx.cwd, String(input.file)), 'utf8'),
        char && char.length === 1 ? char : '#',
      );
      const found = findTerms(text, t.matchers);
      const refused = found.map((m) => ({
        where: 'commit message',
        line: m.line,
        kind: m.kind,
        term_id: m.id,
      }));
      return {
        ok: found.length === 0,
        private_terms: t.matchers.length,
        refused,
        problems: found.map((m) => matchMessage(m, 'commit message')),
        ...(found.length
          ? {
              error: 'private-term',
              message: `refused: the commit message holds ${found.length} private term(s) from the private term list (design part 10.3, rule 7); each problem names its kind and line. Write it again, referring to each by its role`,
            }
          : { message: 'the commit message holds no private term' }),
        ...(t.warnings.length ? { warnings: t.warnings } : {}),
      };
    },
  },
];
