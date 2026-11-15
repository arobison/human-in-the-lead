// Security in "done when" (design part 10.5): the baseline, triage verdicts and accepted risks in
// the private store. The merge queue does the scanning (core/lib/merge/security.mjs); these
// commands show the records, make the baseline on main, and record verdicts and accepted risks.
//
// None of them is an executor's. The records are confidential, and an executor that could write
// them could let its own findings through: it proposes verdicts in its report instead. Accepting a
// real risk is the owner's decision, taken like a decision answer: only from the owner's own turn
// in the main session. The plugin's Bash guard denies these commands to executors at the harness;
// the refusal here is the second line.

import { execFileSync } from 'node:child_process';
import { loadPolicy } from '../../policy/policy.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { ownerCheckoutOf } from '../../env/primary.mjs';
import { runScanner } from '../../security/scan.mjs';
import { openTracker } from '../../tracker/files/tracker.mjs';
import {
  VERDICTS,
  acceptRisk,
  decisionProblem,
  expiredRiskQuestion,
  expiredRisks,
  extendBaseline,
  knowsTool,
  readRecords,
  recordVerdict,
  saveBaseline,
} from '../../security/records.mjs';
import { executorSignal } from '../executor.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 * @typedef {import('../table.mjs').CommandResult} Result
 */

/** @type {import('../args.mjs').ArgSpec} */
const FINDING = {
  name: 'finding',
  type: 'string',
  required: true,
  description: "The finding's key, as the merge queue reported it (12 hex digits)",
};

/** @param {string} error @param {string} message @param {Record<string, unknown>} [more] @returns {Result} */
const fail = (error, message, more = {}) => ({ ok: false, error, message, ...more });

/**
 * The project, read from the primary checkout even from inside a linked worktree: the policy and
 * the scanner commands are the owner's there, never a branch's copy.
 * @param {Ctx} ctx
 */
function project(ctx) {
  const repoRoot = ownerCheckoutOf(ctx.cwd);
  if (!repoRoot)
    return { failure: fail('not_a_repository', `${ctx.cwd} is not in a git repository`) };
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
 * @param {string} name @param {string} whose
 * @param {(input: Record<string, unknown>, ctx: Ctx) => Result} run
 * @returns {(input: Record<string, unknown>, ctx: Ctx) => Result}
 */
const notForExecutors = (name, whose, run) => (input, ctx) => {
  const why = executorSignal(ctx.env, ctx.cwd);
  if (why) {
    return fail(
      'not_permitted',
      `hitld ${name} is ${whose}, through the main session in the primary checkout (${why}); an executor proposes verdicts in its report`,
    );
  }
  try {
    return run(input, ctx);
  } catch (e) {
    return fail('security', /** @type {Error} */ (e).message);
  }
};

/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'security status',
    summary:
      'The baseline, the recorded verdicts and accepted risks, the findings waiting for a verdict, and expired risks as decisions for the owner',
    built_by: 'first-release',
    args: [],
    run: notForExecutors('security status', "the orchestrator's", (_input, ctx) => {
      const p = project(ctx);
      if (p.failure) return p.failure;
      const r = readRecords(p.store);
      /** @type {Record<string, number>} */
      const verdicts = {};
      for (const v of r.verdicts)
        verdicts[String(v.verdict)] = (verdicts[String(v.verdict)] ?? 0) + 1;
      return {
        ok: true,
        classification: 'confidential',
        scanners: p.policy.merge.scanners.map((/** @type {{ name: string }} */ s) => s.name),
        baseline:
          r.baseline === null
            ? null
            : {
                size: r.baseline.length,
                tools: r.tools.map((t) => `${t.tool} ${t.version}`.trim()),
              },
        verdicts,
        accepted: r.accepted.map((a) => ({
          finding: a.key,
          expires: a.expires,
          decision: a.decision,
        })),
        pending: r.pending.map((e) => ({
          finding: e.key,
          tool: e.tool,
          rule: e.rule,
          path: e.path,
          line: e.line,
          item: e.item,
        })),
        decisions: expiredRisks(r).map((risk) => ({
          finding: risk.key,
          expired: risk.expires,
          question: expiredRiskQuestion(risk),
        })),
      };
    }),
  },
  {
    name: 'security baseline',
    summary:
      "Scan main in the primary checkout with each declared scanner and make or extend the baseline for tool versions it does not hold; the merge queue does this itself on a scanner's first run",
    built_by: 'first-release',
    args: [],
    run: notForExecutors('security baseline', "the orchestrator's", (_input, ctx) => {
      const p = project(ctx);
      if (p.failure) return p.failure;
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
          `the primary checkout is not on ${main}: the baseline is made from main`,
        );
      }
      if (git(p.repoRoot, ['status', '--porcelain'])) {
        return fail(
          'dirty',
          'the primary checkout has uncommitted changes: the baseline is made from main as committed',
        );
      }
      const commit = git(p.repoRoot, ['rev-parse', 'HEAD']);
      const r = readRecords(p.store);
      const done = [];
      for (const scanner of p.policy.merge.scanners) {
        const res = runScanner(scanner, p.repoRoot, { primaryRoot: p.repoRoot });
        if (!res.ok) return fail('scanner', res.output, { scanner: scanner.name });
        if (res.tools.every((t) => knowsTool(r, t))) {
          done.push({ scanner: scanner.name, added: 0, tools: [] });
          continue;
        }
        const ext = extendBaseline(r, res, { commit });
        done.push({
          scanner: scanner.name,
          added: ext.added,
          tools: ext.tools,
          created: ext.created,
        });
      }
      if (done.some((d) => d.tools.length)) saveBaseline(p.store, r);
      return {
        ok: true,
        commit,
        scanners: done,
        baseline: { size: r.baseline?.length ?? 0 },
        message: p.policy.merge.scanners.length
          ? undefined
          : 'no scanners are declared in policy merge.scanners',
      };
    }),
  },
  {
    name: 'security verdict',
    summary:
      "Record a triage verdict for a finding the merge queue reported, from the item's evidence: real, by-design or false-positive",
    built_by: 'first-release',
    args: [
      FINDING,
      {
        name: 'verdict',
        type: 'string',
        required: true,
        description: `One of ${VERDICTS.join(', ')}. Only by-design and false-positive let the finding through`,
      },
      {
        name: 'reason',
        type: 'string',
        required: true,
        description:
          'real: the fix and its test; by-design: the trust boundary named at the sink; false-positive: a one-line reason',
      },
      {
        name: 'item',
        type: 'string',
        description:
          'The item whose evidence it cites (default: the item that brought the finding)',
      },
    ],
    run: notForExecutors('security verdict', "the orchestrator's", (input, ctx) => {
      const p = project(ctx);
      if (p.failure) return p.failure;
      const item = /** @type {string | undefined} */ (input.item);
      if (item !== undefined && !/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(item)) {
        return fail('usage', '--item must be an item ID, such as W-12');
      }
      const entry = recordVerdict(p.store, {
        key: String(input.finding),
        verdict: String(input.verdict),
        reason: String(input.reason),
        item,
      });
      return { ok: true, classification: 'confidential', verdict: entry };
    }),
  },
  {
    name: 'security accept',
    summary:
      "Record the owner's acceptance of a real finding as a risk, until an expiry; at expiry it is a decision again. Only from the owner's own message in the main session",
    built_by: 'first-release',
    args: [
      FINDING,
      {
        name: 'expires',
        type: 'string',
        required: true,
        description: 'The date it becomes a decision again, YYYY-MM-DD, in the future',
      },
      { name: 'reason', type: 'string', required: true, description: "The owner's reason" },
      {
        name: 'decision',
        type: 'string',
        required: true,
        description:
          'The decision item the owner answered to accept it (hitld rights ask, then rights answer); it must be Done with an answer',
      },
    ],
    run: notForExecutors('security accept', "the owner's decision", (input, ctx) => {
      const p = project(ctx);
      if (p.failure) return p.failure;
      const decision = String(input.decision);
      if (!/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(decision)) {
        return fail('usage', '--decision must be a decision ID, such as W-40');
      }
      // The tracker of the primary checkout, where the owner's answer was recorded.
      const tracker = openTracker({ repoRoot: p.repoRoot, policy: p.policy, env: ctx.env });
      /** @type {Record<string, unknown> | null} */
      let entity = null;
      try {
        entity = tracker.get(decision);
      } catch {
        entity = null;
      }
      const problem = decisionProblem(decision, entity);
      if (problem) return fail('decision', `${problem}; nothing was recorded`);
      const entry = acceptRisk(p.store, {
        key: String(input.finding),
        expires: String(input.expires),
        reason: String(input.reason),
        decision,
        tracker,
      });
      return { ok: true, classification: 'confidential', accepted: entry };
    }),
  },
];
