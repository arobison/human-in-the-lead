// Piece (f): quotas and the reserve rule (design part 12.5). The reserve rule is a library
// function (core/lib/quota/gate.mjs) that `hitld dispatch plan` calls; these commands show it, and
// `report` writes the static report and the digest (design part 12.4).

import { isAbsolute, join, resolve } from 'node:path';
import { outputProblem, writeReportFiles } from '../../report-output.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { findRepoRoot } from '../../policy/policy.mjs';
import { loadEffectivePolicy } from '../../settings/layers.mjs';
import { dispatchGate } from '../../quota/gate.mjs';
import { buildReport, renderDigest, renderHtml } from '../../quota/report.mjs';
import { readQuotaInputs } from '../../quota/inputs.mjs';
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
        description: 'Also return the report data (the metrics data contract)',
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
      const report = buildReport({
        policy: g.policy,
        snapshots: g.snapshots,
        ledger: g.ledger,
        now: g.now,
      });
      const html = renderHtml(report, g.policy);
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
      };
    },
  },
];
