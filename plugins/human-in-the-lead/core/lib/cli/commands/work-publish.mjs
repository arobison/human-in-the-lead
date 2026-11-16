// `hitld work publish` (HITLD-125): the tracker files a session changed reach main through one
// pull request. The library part is core/lib/tracker/files/publish.mjs; this file runs the checks
// between its steps, in this order, and stops at the first refusal, before anything is pushed:
//
//   1. refuse executors: an executor's tracker changes ride with its own branch;
//   2. gather the changed tracker files (nothing to publish: say so and stop);
//   3. `hitld check commit-message` on the commit message;
//   4. `hitld publish check` on the pull request's title and body;
//   5. build the commit on the remote's main, and check its files as the merge does (the
//      classification ceiling, the store's address and device list, the private term list),
//      since a commit built this way runs no commit hook;
//   6. push it to a new branch (never main, never forced) and print the pull request to open.
//
// hitld does not open the pull request itself: pull requests are not yet published through the
// send gate (design 9.3, 10.3), so the session opens it with the forge's own tool, with the title
// and body that passed the check.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPolicy } from '../../policy/policy.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import {
  checkCommits,
  problemLines,
  rulesFrom,
  isTermRefusal,
} from '../../guard/classification.mjs';
import { termsForProject } from '../../store/private-terms.mjs';
import { openTracker } from '../../tracker/files/tracker.mjs';
import {
  PUBLISH_ROLES,
  branchFor,
  buildCommit,
  composeMessage,
  fetchBase,
  forgeRepo,
  gatherChanges,
  itemIds,
  publishedAs,
  pushBranch,
} from '../../tracker/files/publish.mjs';
import { CodedError } from '../errors.mjs';
import { executorSignal } from '../executor.mjs';
import { commands as guardCommands } from './guard.mjs';
import { commands as privateCommands } from './private.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 * @typedef {import('../table.mjs').CommandResult} Result
 */

/** A command of this table by name. @param {import('../table.mjs').Command[]} list @param {string} name */
const commandNamed = (list, name) => {
  const c = list.find((x) => x.name === name);
  if (!c?.run) throw new Error(`hitld ${name} is not built`);
  return /** @type {NonNullable<typeof c.run>} */ (c.run);
};

/** What the session does with the printed pull request. */
const OPEN_IT =
  "Open the pull request with the forge's own tool (in a cloud session, the GitHub tools): head is the branch, base is the main branch, and the title and body are exactly the ones printed, which passed hitld publish check. hitld does not open it: pull requests do not yet go through the send gate.";

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'work publish',
    summary:
      "Publish the tracker files this session changed (decisions filed or answered): one commit on a new branch from the remote's main, with the project's trailers, checked and pushed, and the pull request to open. Never pushes main; refused to executors",
    built_by: 'a',
    output: [
      'ok',
      'published',
      'dry_run',
      'base',
      'branch',
      'commit',
      'items',
      'files',
      'skipped',
      'left_out',
      'checks',
      'pull_request',
      'opened',
      'next',
      'message',
    ],
    args: [
      {
        name: 'title',
        type: 'string',
        required: true,
        description:
          'The commit subject and pull request title, one line; "Tracker: " is put in front unless it starts so',
      },
      {
        name: 'body',
        type: 'string',
        description: 'What changed and why, for the commit message and the pull request body',
      },
      {
        name: 'role',
        type: 'string',
        description: `The Agent-Role trailer: ${PUBLISH_ROLES.join(' or ')} (default: HITLD_ROLE, when it names one)`,
      },
      {
        name: 'trailer',
        type: 'string',
        repeatable: true,
        description:
          'Another trailer, "Key: value", such as the harness\'s co-author line; once per trailer. Work-Item, Agent-Role and Dispatch are written by the command',
      },
      {
        name: 'branch',
        type: 'string',
        description:
          'The new branch to push (default: hitld/tracker-<first item ID>-<commit>); never the main branch',
      },
      {
        name: 'remote',
        type: 'string',
        description: 'The remote to fetch main from and push to (default origin)',
      },
      {
        name: 'dry-run',
        type: 'boolean',
        description: 'Gather, compose and check everything, and push nothing',
      },
      {
        name: 'repo',
        type: 'string',
        description: 'The repository (default: the one containing the current directory)',
      },
    ],
    async run(input, ctx) {
      const why = executorSignal(ctx.env, ctx.cwd);
      if (why) {
        return {
          ok: false,
          error: 'not-permitted',
          message: `hitld work publish is the orchestrator's or the chief of staff's (${why}); an executor's tracker changes ride with its own branch`,
        };
      }
      const repo = input.repo ? resolve(ctx.cwd, String(input.repo)) : ctx.cwd;
      const loaded = loadPolicy({ cwd: repo });
      if (!loaded.policy) {
        throw new CodedError(
          'policy',
          `policy.json: ${formatErrors(loaded.errors).split('\n').join('; ')}`,
        );
      }
      const policy = loaded.policy;
      const tracker = openTracker({ repoRoot: repo, policy, env: ctx.env });
      const root = tracker.root();
      const layout = tracker.layout();
      const role = String(
        input.role ??
          (PUBLISH_ROLES.includes(String(ctx.env.HITLD_ROLE)) ? ctx.env.HITLD_ROLE : ''),
      );
      const remote = String(input.remote ?? 'origin');
      const dryRun = Boolean(input['dry-run']);
      const trailers = /** @type {string[]} */ (input.trailer ?? []);
      // The message is checked for shape before anything is fetched.
      composeMessage({ title: String(input.title), role, ids: [], trailers, files: [] });

      const base = fetchBase(root, remote, layout.mainBranch);
      const gathered = gatherChanges(root, layout, base.commit);
      const common = {
        dry_run: dryRun,
        base,
        skipped: gathered.skipped,
        left_out: gathered.left_out,
      };
      if (gathered.conflicts.length) {
        return {
          ok: false,
          error: 'main-changed',
          ...common,
          conflicts: gathered.conflicts,
          message: `${layout.mainBranch} changed ${gathered.conflicts.length} tracker file(s) this session changed too, in a way this session has not seen: ${gathered.conflicts.join(', ')}. Bring ${layout.mainBranch} into this branch (git fetch ${remote} ${layout.mainBranch} && git merge FETCH_HEAD), settle the files, and publish again. Nothing was published`,
        };
      }
      if (!gathered.files.length) {
        return {
          ok: true,
          published: false,
          ...common,
          files: [],
          message: gathered.skipped.length
            ? `nothing to publish: ${layout.mainBranch} already has every tracker change this session made`
            : 'nothing to publish: this session changed no tracker file',
        };
      }

      const ids = itemIds(layout, gathered.files);
      const text = composeMessage({
        title: String(input.title),
        body: typeof input.body === 'string' ? input.body : undefined,
        role,
        ids,
        trailers,
        files: gathered.files,
      });
      const shown = {
        items: ids,
        files: gathered.files.map(({ path, change }) => ({ path, change })),
      };

      const dir = mkdtempSync(join(tmpdir(), 'hitld-work-publish-'));
      try {
        const sub = { ...ctx, cwd: root };
        const messageFile = join(dir, 'commit-message');
        writeFileSync(messageFile, text.message);
        const messageCheck = await commandNamed(guardCommands, 'check commit-message')(
          { file: messageFile },
          sub,
        );
        if (!messageCheck.ok) {
          return refusal('commit-message', messageCheck, { ...common, ...shown });
        }
        const titleFile = join(dir, 'pull-request-title');
        const bodyFile = join(dir, 'pull-request-body');
        writeFileSync(titleFile, `${text.pull_request.title}\n`);
        writeFileSync(bodyFile, text.pull_request.body);
        const textCheck = await commandNamed(privateCommands, 'publish check')(
          { file: [titleFile, bodyFile] },
          sub,
        );
        if (!textCheck.ok) {
          return refusal('publish', textCheck, { ...common, ...shown });
        }

        const commit = buildCommit(root, base.commit, gathered.files, text.message);
        const terms = termsForProject({ policy, env: ctx.env, repoRoot: root });
        const judged = checkCommits(root, base.commit, commit, {
          ...rulesFrom(policy, layout.defaultClassification),
          terms: terms.matchers,
        });
        if (judged.refused.length) {
          const termed = judged.refused.some(isTermRefusal);
          return {
            ok: false,
            error: termed ? 'private-term' : 'classification',
            step: 'files',
            ...common,
            ...shown,
            refused: judged.refused.map(({ path, rule, line, kind }) => ({
              path,
              rule,
              line,
              kind,
            })),
            problems: problemLines(judged.refused),
            message: `refused: ${judged.refused.length} file(s) may not go in the project's repository as they are (each problem says why, naming a private term by its kind and line, never the term). Write them again by role, or keep them in the private store; nothing was published`,
          };
        }

        const earlier = publishedAs(root, commit);
        if (earlier) {
          return {
            ok: true,
            published: false,
            ...common,
            branch: earlier,
            ...shown,
            message: `nothing new to publish: this checkout already pushed these tracker changes to ${earlier}, which ${layout.mainBranch} does not have yet; open or merge its pull request`,
          };
        }
        const branch = branchFor(
          layout,
          typeof input.branch === 'string' ? input.branch : undefined,
          ids,
          commit,
        );
        const checks = {
          commit_message: messageCheck.message,
          publish: textCheck.message,
          files: `${judged.files} file(s), none refused`,
        };
        const pullRequest = {
          repo: forgeRepo(root, remote),
          base: layout.mainBranch,
          head: branch,
          ...text.pull_request,
        };
        if (dryRun) {
          return {
            ok: true,
            published: false,
            ...common,
            branch,
            commit,
            ...shown,
            checks,
            pull_request: pullRequest,
            opened: false,
            message: `dry run: ${gathered.files.length} tracker file(s) would be published on ${branch}; nothing was pushed`,
          };
        }
        pushBranch(root, remote, commit, branch);
        return {
          ok: true,
          published: true,
          ...common,
          branch,
          commit,
          ...shown,
          checks,
          pull_request: pullRequest,
          opened: false,
          next: OPEN_IT,
          message: `${gathered.files.length} tracker file(s) pushed to ${branch}, one commit on ${base.ref}; open the pull request`,
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

/**
 * A check that refused, as this command's result.
 * @param {string} step @param {Result} r @param {Record<string, unknown>} rest
 * @returns {Result}
 */
function refusal(step, r, rest) {
  return {
    ...rest,
    ok: false,
    error: String(r.error ?? 'failed'),
    step,
    ...(r.problems ? { problems: r.problems } : {}),
    message: `${String(r.message ?? 'the check refused')}; nothing was published`,
  };
}
