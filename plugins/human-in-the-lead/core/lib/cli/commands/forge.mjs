// `hitld check forge` (HITLD-953): read the live forge settings the owner applied by hand
// (HITLD-952) with a read-only token from the caller, and report each as ok, wrong or cannot-read.
// The token is read from an environment variable the caller names, never from an argument (an
// argument shows in the process list and the shell history), and is never printed.

import { loadPolicy } from '../../policy/policy.mjs';
import { remoteUrl, repoFromRemote } from '../../merge/github.mjs';
import { checkForge, httpForge } from '../../forge/check.mjs';

/** The variable the token is read from unless --token-env names another. */
export const DEFAULT_TOKEN_ENV = 'HITLD_FORGE_TOKEN';

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
        description: `The environment variable that holds the read-only token. Default: ${DEFAULT_TOKEN_ENV}`,
      },
      {
        name: 'queue-app',
        type: 'string',
        description: "The merge queue App's slug. Default: hitld-queue",
      },
      {
        name: 'executor-app',
        type: 'string',
        description: "The executors' App's slug. Default: hitld-executor",
      },
      {
        name: 'release-app',
        type: 'string',
        description: "The release App's slug. Default: hitld-release",
      },
      {
        name: 'allow-app',
        type: 'string',
        repeatable: true,
        description: 'Another App with write access the owner reviewed and kept, by slug',
      },
    ],
    output: ['ok', 'repo', 'lines', 'wrong', 'cannot_read', 'error', 'message'],
    run: async (input, ctx) => {
      const tokenEnv = /** @type {string | undefined} */ (input['token-env']) ?? DEFAULT_TOKEN_ENV;
      const token = ctx.env[tokenEnv];
      if (!token) {
        return {
          ok: false,
          error: 'no-forge-token',
          message: `no token in ${tokenEnv}: set it to a read-only fine-grained token (Administration, Actions, Contents, Metadata read) for this repository, or name another variable with --token-env`,
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
      const get = ctx.forge ? ctx.forge(token) : httpForge(token);
      const lines = await checkForge({
        get,
        repo,
        contexts: pr.checks ?? [],
        apps: {
          queue: /** @type {string | undefined} */ (input['queue-app']),
          executor: /** @type {string | undefined} */ (input['executor-app']),
          release: /** @type {string | undefined} */ (input['release-app']),
        },
        allowApps: /** @type {string[] | undefined} */ (input['allow-app']) ?? [],
      });
      const wrong = lines.filter((l) => l.result === 'wrong').length;
      const cannotRead = lines.filter((l) => l.result === 'cannot-read').length;
      return { ok: wrong === 0 && cannotRead === 0, repo, lines, wrong, cannot_read: cannotRead };
    },
  },
];
