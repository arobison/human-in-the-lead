// Piece (f): quotas and the reserve rule (design part 12.5). The reserve rule is a library
// function (core/lib/quota/gate.mjs) that `hitld dispatch plan` calls; these commands show it, and
// `report` writes the static report and the digest (design part 12.4).

import { isAbsolute, join, resolve } from 'node:path';
import { outputProblem, writeReportFiles } from '../../report-output.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { findRepoRoot } from '../../policy/policy.mjs';
import { loadEffectivePolicy } from '../../settings/layers.mjs';
import { dispatchGate } from '../../quota/gate.mjs';
import { buildReport, renderDigest, renderHtml, tokensPerItem } from '../../quota/report.mjs';
import { openTracker } from '../../tracker/files/tracker.mjs';
import { git } from '../../tracker/files/tree.mjs';
import { forgeFileBase } from '../../tracker/files/views.mjs';

/**
 * Where the repository's files are on its forge, for the page's links to tracker files: from the
 * `origin` remote and its default branch (HEAD, which the forge resolves, when origin/HEAD is not
 * set). Null when there is no repository or its remote is not a known forge.
 * @param {string | null | undefined} repoRoot
 */
function repositoryFileBase(repoRoot) {
  if (!repoRoot) return null;
  const remote = git(repoRoot, ['remote', 'get-url', 'origin'], { allowFail: true }).trim();
  const head = git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    allowFail: true,
  }).trim();
  return forgeFileBase(remote, head.startsWith('origin/') ? head.slice('origin/'.length) : 'HEAD');
}
import { readQuotaInputs } from '../../quota/inputs.mjs';
import { DECLARED_SOURCE, shownLimits } from '../../quota/quota.mjs';
import { SNAPSHOTS_KEY } from '../../quota/usage.mjs';
import { resetsAtMs } from '../../quota/window.mjs';
import { schemas } from '../../schema/registry.mjs';
import { executorSignal } from '../executor.mjs';
import { workModel } from '../../dashboard/work.mjs';
import { ownerDigest } from './rights.mjs';

/**
 * Everything the quota commands read: the policy, the snapshots, the ledger, and the time.
 * @param {import('../table.mjs').CommandContext} ctx
 * @param {Record<string, unknown>} input
 */
function gather(ctx, input) {
  // The person's limits, reserve and thresholds layered over the project's (design part 13.4).
  const loaded = loadEffectivePolicy({ cwd: ctx.cwd, env: ctx.env });
  if (!loaded.policy) {
    return {
      error: {
        ok: false,
        error: 'policy',
        message: loaded.project
          ? 'a settings file is invalid; run hitld config explain'
          : 'policy.json is missing or invalid; run hitld check policy',
        errors: loaded.errors,
      },
    };
  }
  let now = Date.now();
  if (input.now !== undefined) {
    now = Date.parse(String(input.now));
    if (Number.isNaN(now)) {
      return { error: { ok: false, error: 'usage', message: '--now is not a timestamp' } };
    }
  }
  const repoRoot = findRepoRoot(ctx.cwd) ?? undefined;
  const store = openStore(privateStorePath(loaded.policy.project.id, { env: ctx.env, repoRoot }));
  // The project's own snapshots and every account's from the machine registry.
  const { snapshots, skipped, ledger } = readQuotaInputs(store);
  return {
    error: null,
    policy: loaded.policy,
    repoRoot,
    store,
    snapshots,
    skipped,
    ledger,
    now,
    warnings: loaded.warnings.map((w) => w.message),
  };
}

const KIND = { marker: '.hitld-report.json', files: ['dashboard.html', 'digest.txt'] };
/** The page's name before it matched the command. A directory written under it is still accepted, and the old file is removed. */
const RETIRED = ['report.html'];

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'quota status',
    summary: 'Each quota with its headroom and forecast, and what the dispatch gate says now',
    built_by: 'f',
    args: [
      {
        name: 'critical-path',
        type: 'boolean',
        description: 'Ask the gate about an item on the critical path',
      },
      {
        name: 'now',
        type: 'string',
        description: 'Evaluate at this time (a timestamp), for tests',
      },
    ],
    run: (input, ctx) => {
      const g = gather(ctx, input);
      if (g.error) return g.error;
      const gate = dispatchGate(
        g.policy,
        g.snapshots,
        { critical_path: input['critical-path'] === true },
        { now: g.now, ledger: g.ledger },
      );
      return {
        ok: true,
        skipped_snapshots: g.skipped,
        ...(g.warnings.length ? { warnings: g.warnings } : {}),
        ...gate,
      };
    },
  },
  {
    name: 'quota declare',
    summary:
      "Record a usage figure the owner reads on their own account, for a limit with no fresh measured reading. The owner's, from their own turn",
    built_by: 'f',
    args: [
      {
        name: 'used',
        type: 'string',
        required: true,
        description:
          "The limit's use as the owner's account shows it, in the limit's unit (a percentage of the plan for plan-percent limits, such as 37 or 37.5)",
      },
      {
        name: 'resets-at',
        type: 'string',
        required: true,
        description: "When the limit's window resets, as the account shows it (a timestamp)",
      },
      {
        name: 'limit',
        type: 'string',
        description: 'The limit, by its ID in the quota limits (default claude-weekly)',
      },
      {
        name: 'now',
        type: 'string',
        description: 'Record it as taken at this time (a timestamp), for tests',
      },
    ],
    run: (input, ctx) => {
      // The figure is the owner's word on their own account (HITLD-164): taken only from the
      // owner's own turn on the human command line, like a decision answer, and never from an
      // executor. The plugin's Bash guard refuses it to executors at the harness first.
      const why = executorSignal(ctx.env, ctx.cwd);
      if (why || ctx.interactive !== true) {
        return {
          ok: false,
          error: 'not-permitted',
          message: `quota declare is the owner's, from their own turn through the main session in the primary checkout (${why ?? 'not the human command line'}); an executor never declares usage`,
        };
      }
      const g = gather(ctx, input);
      if (g.error) return g.error;
      const id = typeof input.limit === 'string' && input.limit ? input.limit : 'claude-weekly';
      const limit = shownLimits(g.policy.quota.limits, g.snapshots, g.now).find(
        (/** @type {any} */ l) => l.id === id,
      );
      if (!limit) {
        const known = g.policy.quota.limits.map((/** @type {any} */ l) => l.id).join(', ');
        return {
          ok: false,
          error: 'usage',
          message: `no quota limit ${id}; the limits are ${known || 'none'}`,
        };
      }
      const used = Number(String(input.used).trim().replace(/%$/, ''));
      if (!String(input.used).trim() || !Number.isFinite(used) || used < 0) {
        return { ok: false, error: 'usage', message: '--used is not a number of 0 or more' };
      }
      if (limit.limit != null && used > limit.limit) {
        return {
          ok: false,
          error: 'usage',
          message: `--used ${used} is more than the limit of ${limit.limit} for ${id}`,
        };
      }
      const resets = resetsAtMs(String(input['resets-at']));
      if (resets == null) {
        return { ok: false, error: 'usage', message: '--resets-at is not a timestamp' };
      }
      if (resets <= g.now) {
        return {
          ok: false,
          error: 'usage',
          message: '--resets-at is not in the future: give the reset the account shows now',
        };
      }
      const snapshot = {
        schema_version: schemas().currentVersion('usage-snapshot'),
        at: new Date(g.now).toISOString(),
        source: DECLARED_SOURCE,
        readings: [{ limit: id, used, resets_at: new Date(resets).toISOString() }],
      };
      const errors = schemas().validateEntity('usage-snapshot', snapshot);
      if (errors.length) {
        return {
          ok: false,
          error: 'invalid-snapshot',
          message: errors.map((e) => `${e.path} ${e.message}`).join('; '),
        };
      }
      g.store.append(SNAPSHOTS_KEY, JSON.stringify(snapshot) + '\n');
      // What the gate makes of it now: a fresh measured reading still wins (HITLD-170).
      const gate = dispatchGate(
        g.policy,
        [...g.snapshots, snapshot],
        {},
        {
          now: g.now,
          ledger: g.ledger,
        },
      );
      const state = gate.quotas.find((q) => q.id === id);
      return {
        ok: true,
        recorded: snapshot,
        used_from: state?.used_from ?? null,
        mode: gate.mode,
        reason: gate.reason,
        ...(state?.used_from === 'snapshot'
          ? {
              note: `a measured reading from ${state.as_of} is still fresh, so the gate uses it; the declared figure is the fallback once it is not`,
            }
          : {}),
        ...(g.warnings.length ? { warnings: g.warnings } : {}),
      };
    },
  },
  {
    name: 'dashboard',
    summary: 'Write the static HTML dashboard and the text digest from the ledger and the quotas',
    built_by: 'f',
    args: [
      {
        name: 'out',
        type: 'string',
        mcp: false,
        description:
          'The directory to write dashboard.html and digest.txt in (inside the repository or the private store; default: reports/ in the private store)',
      },
      {
        name: 'json',
        type: 'boolean',
        description:
          'Also return the report data (the metrics data contract); the files are still written unless --no-write is given',
      },
      {
        name: 'no-write',
        type: 'boolean',
        description:
          'Write no files: return the report data (the metrics data contract) and the digest text only',
      },
      {
        name: 'now',
        type: 'string',
        description: 'Report as of this time (a timestamp), for tests',
      },
    ],
    run: async (input, ctx) => {
      const g = gather(ctx, input);
      if (g.error) return g.error;
      // The milestone graph (design part 12.1.2), from the repository's tracker, with tokens
      // spent from the ledger. A repository with no tracker gets a page without it.
      /** @type {import('../../tracker/files/views.mjs').MilestoneGraph | null} */
      let milestones = null;
      /** @type {string[]} */
      const warnings = [];
      /** @type {import('../../dashboard/work.mjs').WorkModel | null} */
      let work = null;
      if (g.repoRoot) {
        const repoRoot = g.repoRoot;
        try {
          const tracker = openTracker({ repoRoot, policy: g.policy, env: ctx.env });
          milestones = tracker.milestoneGraph({ tokens: tokensPerItem(g.ledger) });
          // The work views read the tracker's read API: the entities, the claims and the
          // committed state history (HITLD-152).
          try {
            const read = (/** @type {string[]} */ args) =>
              git(repoRoot, args, { allowFail: true }).trim() || null;
            work = workModel({
              entities: tracker.query({}).map((e) => /** @type {Record<string, any>} */ (e)),
              claims: tracker.claims(),
              histories: tracker.histories(),
              ledger: g.ledger,
              now: g.now,
              source: {
                commit: read(['rev-parse', '--short', 'HEAD']),
                branch: read(['branch', '--show-current']),
                shallow: read(['rev-parse', '--is-shallow-repository']) === 'true',
              },
            });
          } catch (e) {
            warnings.push(
              `the work views are left out: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } catch (e) {
          warnings.push(
            `the milestone graph is left out: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      const report = buildReport({
        policy: g.policy,
        snapshots: g.snapshots,
        ledger: g.ledger,
        now: g.now,
        milestones,
        work,
      });
      const html = renderHtml(report, g.policy, { fileBase: repositoryFileBase(g.repoRoot) });
      // The digest is the one `hitld rights digest` builds, with this report's quota lines. It is
      // only read here: the cursor does not move. A project whose decisions cannot be read gets
      // the quota lines alone.
      /** @type {string} */
      let digest = renderDigest(report);
      try {
        const made = await ownerDigest(ctx, {
          now: new Date(g.now).toISOString(),
          report,
        });
        if (made.ok && 'digest' in made) digest = made.digest.text;
      } catch {
        // Keep the quota lines.
      }
      const warned = warnings.length ? { warnings } : {};
      if (input['no-write']) {
        return { ok: true, mode: report.gate.mode, text: digest, report, ...warned };
      }
      const dir =
        typeof input.out === 'string'
          ? isAbsolute(input.out)
            ? input.out
            : resolve(ctx.cwd, input.out)
          : join(g.store.root, 'reports');
      const roots = [g.store.root, findRepoRoot(ctx.cwd) ?? ctx.cwd];
      const problem = outputProblem(dir, roots, KIND);
      if (problem) return { ok: false, error: 'output-path', message: problem };
      const real = writeReportFiles(
        dir,
        KIND.marker,
        { 'dashboard.html': html, 'digest.txt': digest },
        RETIRED,
      );
      return {
        ok: true,
        html: join(real, 'dashboard.html'),
        digest: join(real, 'digest.txt'),
        mode: report.gate.mode,
        text: digest,
        ...(input.json ? { report } : {}),
        ...warned,
      };
    },
  },
];
