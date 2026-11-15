// Flaky tests (design part 14.7): the quarantine file and the flake section of a digest.
//
// The queue finds flakes (core/lib/merge/queue.mjs) and records the evidence in the private store.
// These commands are the orchestrator's: it may quarantine a test on that evidence without asking,
// and reports it in the digest. An executor never does, and the refusal here is the second line
// behind the plugin's Bash guard and the merge queue, which refuses any branch that changes the
// file. The file is committed on main by the orchestrator, as the tracker files it creates are.

import { execFileSync } from 'node:child_process';
import { loadPolicy } from '../../policy/policy.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { ownerCheckoutOf } from '../../env/primary.mjs';
import { openTracker } from '../../tracker/files/tracker.mjs';
import { decisionProblem } from '../../security/records.mjs';
import {
  QUARANTINE_PATH,
  addEntry,
  expiredEntries,
  expiredQuestion,
  expiryFrom,
  flakeDigest,
  environmentLabels,
  quarantineEvidence,
  readFlakes,
  readQuarantine,
  recordQuarantineEvent,
  writeQuarantine,
} from '../../merge/quarantine.mjs';
import { executorSignal } from '../executor.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 * @typedef {import('../table.mjs').CommandResult} Result
 */

const ID = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;

/** @param {string} error @param {string} message @param {Record<string, unknown>} [more] @returns {Result} */
const fail = (error, message, more = {}) => ({ ok: false, error, message, ...more });

/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * The project, read from the primary checkout even from a linked worktree: the policy, the
 * quarantine file and the tracker are the owner's there, never a branch's copy.
 * @param {Ctx} ctx
 */
function project(ctx) {
  const repoRoot = ownerCheckoutOf(ctx.cwd);
  if (!repoRoot) {
    return { failure: fail('not_a_repository', `${ctx.cwd} is not in a git repository`) };
  }
  const loaded = loadPolicy({ cwd: repoRoot });
  if (!loaded.policy) {
    return {
      failure: fail('policy', 'policy.json is missing or invalid; run hitld check policy', {
        errors: loaded.errors,
      }),
    };
  }
  const store = openStore(privateStorePath(loaded.policy.project.id, { env: ctx.env, repoRoot }));
  return { repoRoot, policy: loaded.policy, store };
}

/**
 * Refuse an executor, then run.
 * @param {string} name
 * @param {(input: Record<string, unknown>, ctx: Ctx) => Result} run
 * @returns {(input: Record<string, unknown>, ctx: Ctx) => Result}
 */
const orchestratorOnly = (name, run) => (input, ctx) => {
  const why = executorSignal(ctx.env, ctx.cwd);
  if (why) {
    return fail(
      'not_permitted',
      `hitld ${name} is the orchestrator's, in the primary checkout (${why}); an executor never quarantines a test: say in your report which test failed and the rerun that shows it flaky`,
    );
  }
  try {
    return run(input, ctx);
  } catch (e) {
    return fail('quarantine', /** @type {Error} */ (e).message);
  }
};

/** @param {unknown} csv @returns {string[]} */
const names = (csv) =>
  String(csv ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Same test, same scope. @param {{ id: string, environments?: string[] }} a @param {{ id: string, environments?: string[] }} b */
const sameEntry = (a, b) =>
  a.id === b.id &&
  [...(a.environments ?? [])].sort().join(',') === [...(b.environments ?? [])].sort().join(',');

const TEST = {
  name: 'test',
  type: /** @type {const} */ ('string'),
  required: true,
  description: "The test's ID, as the project's test report names it",
};
const ENVIRONMENT = {
  name: 'environment',
  type: /** @type {const} */ ('string'),
  description:
    'Comma-separated environments it fails in (an operating system such as linux, or a label from policy flake.environments); without it, the entry holds everywhere',
};

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'quarantine list',
    summary:
      'The flake section of a digest: quarantined tests with their expiry and fix item, the list size and oldest entry, what quarantined tests caught, and the flake measures; expired entries come with the decision question for the owner',
    built_by: 'first-release',
    args: [],
    run: (_input, ctx) => {
      const p = project(ctx);
      if (p.failure) return p.failure;
      const q = readQuarantine(p.repoRoot);
      if (!q.file) {
        return fail('quarantine', `${QUARANTINE_PATH} is refused: ${q.problems.join('; ')}`, {
          problems: q.problems,
        });
      }
      const now = new Date();
      const digest = flakeDigest({
        file: q.file,
        records: readFlakes(p.store),
        now,
        labels: environmentLabels(p.policy.flake),
        quarantineDays: p.policy.flake.quarantine_days,
      });
      return {
        ok: true,
        ...digest,
        decisions: expiredEntries(q.file, now).map((e) => ({
          test: e.id,
          expired: e.expires,
          fix_item: e.fix_item,
          question: expiredQuestion(e),
        })),
      };
    },
  },
  {
    name: 'quarantine add',
    summary:
      "Quarantine a test on the queue's evidence, without asking: it failed and then passed on the same commit, and it fails on the base too. Writes the entry (expiry and fix item required) in the primary checkout; the orchestrator commits it on main. An expired entry is renewed only with the owner's answered decision",
    built_by: 'first-release',
    args: [
      TEST,
      {
        name: 'fix-item',
        type: 'string',
        required: true,
        description:
          'The work item that fixes it, with the evidence attached; it must exist and not be done',
      },
      ENVIRONMENT,
      {
        name: 'decision',
        type: 'string',
        description:
          'To renew an expired entry: the decision item the owner answered (fix it, rewrite it or delete it, and the owner chose to wait)',
      },
    ],
    run: orchestratorOnly('quarantine add', (input, ctx) => {
      const p = project(ctx);
      if (p.failure) return p.failure;
      const test = String(input.test);
      const fixItem = String(input['fix-item']);
      if (!ID.test(fixItem)) return fail('usage', '--fix-item must be an item ID, such as W-12');
      const main = p.policy.merge.main_branch;
      let branch = '';
      try {
        branch = git(p.repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
      } catch {
        // detached
      }
      if (branch !== main) {
        return fail(
          'not_on_main',
          `the primary checkout is not on ${main}: the quarantine is main's`,
        );
      }
      const q = readQuarantine(p.repoRoot);
      if (!q.file) {
        return fail('quarantine', `${QUARANTINE_PATH} is refused: ${q.problems.join('; ')}`, {
          problems: q.problems,
        });
      }
      const tracker = openTracker({ repoRoot: p.repoRoot, policy: p.policy, env: ctx.env });
      /** @param {string} id @returns {Record<string, unknown> | null} */
      const entityOf = (id) => {
        try {
          return tracker.get(id);
        } catch {
          return null;
        }
      };
      const fix = entityOf(fixItem);
      if (!fix || fix.kind !== 'work') {
        return fail('fix_item', `${fixItem} is not a work item in the tracker; create it first`);
      }
      if (fix.state === 'done' || fix.state === 'dropped') {
        return fail(
          'fix_item',
          `${fixItem} is ${String(fix.state)}: a fix item that is open holds the entry`,
        );
      }
      const entry = {
        id: test,
        ...(names(input.environment).length ? { environments: names(input.environment) } : {}),
        expires: expiryFrom(new Date(), p.policy.flake.quarantine_days),
        fix_item: fixItem,
      };
      const existing = q.file.tests.find((e) => sameEntry(e, entry));
      if (existing) {
        const expired = expiredEntries(q.file, new Date()).includes(existing);
        if (!expired) {
          return fail(
            'exists',
            `"${test}" is quarantined until ${existing.expires} (${existing.fix_item})`,
          );
        }
        // Renewal is the owner's: the entry ended, and the decision was to wait.
        const decision = input.decision === undefined ? '' : String(input.decision);
        if (!ID.test(decision)) {
          return fail(
            'decision',
            `the entry for "${test}" expired on ${existing.expires}: it gates again, and renewing it needs the owner's answered decision (--decision); hitld quarantine list has the question`,
          );
        }
        const problem = decisionProblem(decision, entityOf(decision));
        if (problem) return fail('decision', `${problem}; nothing was changed`);
      } else {
        const evidence = quarantineEvidence(readFlakes(p.store), test);
        if (!evidence) {
          return fail(
            'no_evidence',
            `no recorded evidence for "${test}": the queue has to have seen it fail and then pass on the same commit, fail on the base as well, and not be a test a branch under test added or changed. Without that it belongs to the change (design 14.7)`,
          );
        }
      }
      const without = {
        ...q.file,
        tests: q.file.tests.filter((e) => !sameEntry(e, entry)),
      };
      const added = addEntry(without, entry);
      if ('problems' in added) return fail('quarantine', `refused: ${added.problems.join('; ')}`);
      const path = writeQuarantine(p.repoRoot, added.file);
      recordQuarantineEvent(p.store, { kind: 'quarantined', test, fix_item: fixItem });
      return {
        ok: true,
        entry,
        path,
        next: `commit ${QUARANTINE_PATH} on ${main} (the queue reads main's committed file), and report the entry in the next digest. The fix item is done when its reproduction passes and a stress run of ${p.policy.flake.fixed_runs} passes under load; then hitld quarantine remove`,
      };
    }),
  },
  {
    name: 'quarantine remove',
    summary:
      "Remove a test's entry once its fix item is done, or once the entry has expired and the owner has decided. Writes the file in the primary checkout; the orchestrator commits it",
    built_by: 'first-release',
    args: [TEST, ENVIRONMENT],
    run: orchestratorOnly('quarantine remove', (input, ctx) => {
      const p = project(ctx);
      if (p.failure) return p.failure;
      const q = readQuarantine(p.repoRoot);
      if (!q.file) {
        return fail('quarantine', `${QUARANTINE_PATH} is refused: ${q.problems.join('; ')}`, {
          problems: q.problems,
        });
      }
      const want = { id: String(input.test), environments: names(input.environment) };
      const entry = q.file.tests.find((e) => sameEntry(e, want));
      if (!entry) return fail('not_found', `"${want.id}" is not in the quarantine`);
      let state = '';
      try {
        state = String(
          openTracker({ repoRoot: p.repoRoot, policy: p.policy, env: ctx.env }).get(entry.fix_item)
            .state,
        );
      } catch {
        state = 'unknown';
      }
      const expired = expiredEntries(q.file, new Date()).includes(entry);
      if (state !== 'done' && !expired) {
        return fail(
          'fix_not_done',
          `${entry.fix_item} is ${state}: the entry stays until the fix merges (it ends ${entry.expires} on its own)`,
        );
      }
      const path = writeQuarantine(p.repoRoot, {
        ...q.file,
        tests: q.file.tests.filter((e) => e !== entry),
      });
      recordQuarantineEvent(p.store, {
        kind: 'removed',
        test: entry.id,
        fix_item: entry.fix_item,
      });
      return {
        ok: true,
        removed: entry,
        path,
        next: `commit ${QUARANTINE_PATH} on ${p.policy.merge.main_branch}`,
      };
    }),
  },
  {
    name: 'check quarantine',
    summary:
      'Check the quarantine file: every entry has a test ID, an expiry and a fix item, and nothing else. The merge queue applies the same check to main and refuses any branch that changes the file',
    built_by: 'first-release',
    args: [],
    run: (_input, ctx) => {
      let root = ctx.cwd;
      try {
        root = git(ctx.cwd, ['rev-parse', '--show-toplevel']);
      } catch {
        // not in a repository: the file is looked for here
      }
      const r = readQuarantine(root);
      if (!r.present) {
        return {
          ok: true,
          present: false,
          tests: 0,
          problems: [],
          message: `no ${QUARANTINE_PATH}: nothing is quarantined`,
        };
      }
      const n = r.file?.tests.length ?? 0;
      return {
        ok: r.file !== null,
        present: true,
        tests: n,
        problems: r.problems,
        message: r.file
          ? `${n} entr${n === 1 ? 'y' : 'ies'}, each with an expiry and a fix item`
          : `refused: ${r.problems.join('; ')}`,
      };
    },
  },
];
