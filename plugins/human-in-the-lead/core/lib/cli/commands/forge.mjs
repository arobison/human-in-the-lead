// `hitld check forge` (HITLD-953): read the live forge settings the owner applied by hand
// (HITLD-952) with a read-only token from the caller, and report each as ok, wrong or cannot-read.
// The token is read from an environment variable the caller names, never from an argument (an
// argument shows in the process list and the shell history), and is never printed. Nor is the
// value given to --token-env: a token pasted there by mistake must not come back out.

import { loadPolicy } from '../../policy/policy.mjs';
import { remoteUrl, repoFromRemote } from '../../merge/github.mjs';
import {
  NOT_CHECKED,
  TOKEN_GUIDANCE,
  checkForge,
  httpForge,
  redacting,
} from '../../forge/check.mjs';

/** The variable the token is read from unless --token-env names another. */
export const DEFAULT_TOKEN_ENV = 'HITLD_FORGE_TOKEN';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'check forge',
    summary:
      'Read the live forge settings with a read-only token and report each as ok, wrong (found, expected, where to fix it) or cannot-read (status, permission needed)',
    built_by: 'first-release',
    args: [
      {
        name: 'repo',
        type: 'string',
        description: 'The repository as owner/name. Default: the one the git remote "origin" names',
      },
      {
        name: 'token-env',
        type: 'string',
        description: `The name of the environment variable that holds the read-only token, never the token itself. Default: ${DEFAULT_TOKEN_ENV}`,
      },
      {
        name: 'queue-app',
        type: 'string',
        description: "The merge queue App's slug. Default: hitld-queue",
      },
      {
        name: 'release-app',
        type: 'string',
        description: "The release App's slug. Default: hitld-release",
      },
    ],
    output: ['ok', 'repo', 'lines', 'wrong', 'cannot_read', 'not_checked', 'error', 'message'],
    run: async (input, ctx) => {
      const named = /** @type {string | undefined} */ (input['token-env']);
      if (named !== undefined && !ENV_NAME.test(named)) {
        return {
          ok: false,
          error: 'no-forge-token',
          message:
            'the --token-env value is not an environment variable name; give the name of the variable that holds the token, never the token',
        };
      }
      const token = ctx.env[named ?? DEFAULT_TOKEN_ENV];
      if (!token) {
        const where =
          named === undefined
            ? `${DEFAULT_TOKEN_ENV} is unset or empty`
            : 'the variable --token-env names is unset or empty';
        return {
          ok: false,
          error: 'no-forge-token',
          message: `${where}: set it to ${TOKEN_GUIDANCE}`,
        };
      }
      const loaded = loadPolicy({ cwd: ctx.cwd });
      if (!loaded.policy) {
        return {
          ok: false,
          error: 'policy',
          message: 'policy.json is missing or invalid; run hitld check policy',
        };
      }
      const pr = loaded.policy.merge.pull_request ?? {};
      let repo = /** @type {string | undefined} */ (input.repo);
      if (!repo) {
        const url = loaded.path ? remoteUrl(ctx.cwd, pr.remote ?? 'origin') : null;
        repo = (url && repoFromRemote(url)) || undefined;
      }
      if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
        return {
          ok: false,
          error: 'no-forge-repo',
          message: 'name the repository with --repo owner/name; the git remote names none',
        };
      }
      const get = redacting(ctx.forge ? ctx.forge(token) : httpForge(token), token);
      const lines = await checkForge({
        get,
        repo,
        contexts: pr.checks ?? [],
        apps: {
          queue: /** @type {string | undefined} */ (input['queue-app']),
          release: /** @type {string | undefined} */ (input['release-app']),
        },
      });
      const wrong = lines.filter((l) => l.result === 'wrong').length;
      const cannotRead = lines.filter((l) => l.result === 'cannot-read').length;
      return {
        ok: wrong === 0 && cannotRead === 0,
        repo,
        lines,
        wrong,
        cannot_read: cannotRead,
        not_checked: NOT_CHECKED,
      };
    },
  },
];
