// Piece (g): the eval runner, offline first (design part 17).

import { isAbsolute, join, resolve } from 'node:path';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { schemas } from '../../schema/registry.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import {
  acceptBaseline,
  acceptRefusal,
  findBaseline,
  fromLegacyResult,
  provenanceRefusal,
} from '../../eval/results.mjs';
import { ownerCheckoutOf } from '../../env/primary.mjs';
import { executorSignal } from '../executor.mjs';
import { renderEvalReport } from '../../eval/report.mjs';
import { outputProblem, writeReportFiles } from '../../report-output.mjs';

const MARKER = '.hitld-eval-report.json';
const RUN_ID = /^EV-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$/;

/**
 * True when the process looks like an executor's: accepting a baseline is the owner's decision
 * (design part 17.9). See executorSignal for what this can and cannot prove.
 * @param {import('../table.mjs').CommandContext} ctx
 */
const isExecutor = (ctx) =>
  Boolean(ctx.env?.HITLD_DISPATCH) || executorSignal(ctx.env, ctx.cwd) !== null;

const EXECUTOR_REFUSAL = {
  ok: false,
  error: 'not_allowed',
  message: "accepting a baseline is the owner's decision (design part 17.9); executors never do it",
};

/**
 * The private store of the project (or the stand-in one `hitld eval` uses when there is no
 * policy.json), and the IDs of the runs in it.
 * @param {import('../table.mjs').CommandContext} ctx
 */
function openEvalStore(ctx) {
  const loaded = loadPolicy({ cwd: ctx.cwd });
  const project = loaded.policy
    ? loaded.policy.project.id
    : loaded.path === null
      ? 'hitld-evals'
      : null;
  if (project === null) {
    return {
      ok: /** @type {const} */ (false),
      error: 'policy',
      message: 'policy.json is not valid; run hitld check policy',
      errors: loaded.errors,
    };
  }
  const store = openStore(privateStorePath(project, { env: ctx.env, repoRoot: ctx.cwd }));
  const stored = store
    .list('eval/results/')
    .filter((k) => k.endsWith('.json'))
    .map((k) => k.slice('eval/results/'.length, -'.json'.length))
    .filter((id) => RUN_ID.test(id));
  return { ok: /** @type {const} */ (true), store, stored };
}

/**
 * The main branch of the project in a checkout: policy.json merge.main_branch, or main.
 * @param {string} root
 */
const mainBranchOf = (root) => loadPolicy({ cwd: root }).policy?.merge?.main_branch ?? 'main';

/**
 * A stored run, checked against its schema.
 * @param {import('../../store/store.mjs').PrivateStore} store @param {string} id
 */
function readRun(store, id) {
  const doc = fromLegacyResult(JSON.parse(store.read(`eval/results/${id}.json`) ?? 'null'));
  const errors = schemas().validateEntity('eval-result', doc);
  if (errors.length) {
    return {
      ok: /** @type {const} */ (false),
      error: 'bad_run',
      message: `the stored run ${id} is not a valid eval result: ${formatErrors(errors)}`,
    };
  }
  return { ok: /** @type {const} */ (true), run: /** @type {Record<string, any>} */ (doc) };
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'eval',
    summary:
      'Run the eval suite: --offline runs the deterministic scenarios against the fake adapter and gates on the baseline (--live, --harness and --sealed come later)',
    built_by: 'g',
    args: [
      {
        name: 'offline',
        type: 'boolean',
        description:
          "Deterministic scenarios only: fast and free. Records the run in the private store and compares it with the baseline: the one committed in evals/baselines/ first, the private store's second. The result says which it used",
      },
      {
        name: 'require-baseline',
        type: 'boolean',
        description:
          "Fail unless a baseline committed in evals/baselines/ matches these settings (mode, seed and profiles). The private store's baseline does not count. CI and the release use it; a scenario the baseline has not seen is still only a note",
      },
      {
        name: 'live',
        type: 'boolean',
        description: 'Not built yet: scenarios that need a model (see core/lib/eval/live.mjs)',
      },
      {
        name: 'scenarios',
        type: 'string',
        description:
          'Run only these scenarios: comma-separated IDs or ID prefixes, such as foundation or foundation/policy-check',
      },
      {
        name: 'seed',
        type: 'integer',
        description:
          'Seeds the fixtures and the order of scenarios (default 1). A baseline is kept per seed',
      },
      {
        name: 'accept-baseline',
        type: 'boolean',
        description:
          "Record this full, passing run as the baseline the gate compares with: in the private store, and as evals/baselines/<mode>-<settings hash>.json in the primary checkout, which the owner commits. The owner's decision (design part 17.9): agents do not pass it. To accept a run you have already reviewed, use hitld eval accept --result <id> instead",
      },
      {
        name: 'evals-dir',
        type: 'string',
        description:
          "Use only this evals directory (default: the plugin's evals/ and the project's own)",
      },
    ],
    run: async (input, ctx) => {
      if (input.live) {
        const { LiveNotBuilt } = await import('../../eval/live.mjs');
        return { ok: false, error: 'not_built', message: new LiveNotBuilt().message };
      }
      if (!input.offline) {
        return {
          ok: false,
          error: 'usage',
          message: 'say which mode: hitld eval --offline (--live is not built yet)',
        };
      }
      if (input['accept-baseline'] === true && isExecutor(ctx)) return EXECUTOR_REFUSAL;
      const { evalOffline } = await import('../../eval/offline.mjs');
      return evalOffline({
        cwd: ctx.cwd,
        env: ctx.env,
        scenarios: /** @type {string | undefined} */ (input.scenarios),
        seed: /** @type {number | undefined} */ (input.seed),
        acceptBaseline: input['accept-baseline'] === true,
        requireBaseline: input['require-baseline'] === true,
        evalsDir: /** @type {string | undefined} */ (input['evals-dir']),
      });
    },
  },
  {
    name: 'eval report',
    summary:
      'Write a static HTML page for a stored eval run (the latest unless --result names one): verdict, changes against the baseline, every scenario, and the command that accepts it as the baseline',
    built_by: 'g',
    args: [
      {
        name: 'result',
        type: 'string',
        description:
          'The run ID to render, such as EV-20261114T031500Z-ab12cd (default: the latest)',
      },
      {
        name: 'out',
        type: 'string',
        mcp: false,
        description:
          'The directory to write the page in (inside the repository or the private store; default: reports/ in the private store)',
      },
    ],
    run: (input, ctx) => {
      const opened = openEvalStore(ctx);
      if (!opened.ok) return opened;
      const { store, stored } = opened;
      const repoRoot = findRepoRoot(ctx.cwd) ?? undefined;
      let id = input.result;
      if (id === undefined) {
        // IDs start with a UTC timestamp, so the last one sorted is the newest.
        id = [...stored].sort().at(-1);
        if (!id) {
          return {
            ok: false,
            error: 'no_run',
            message: 'no eval run is stored yet; run hitld eval --offline first',
          };
        }
      } else if (typeof id !== 'string' || !RUN_ID.test(id) || !stored.includes(id)) {
        return {
          ok: false,
          error: 'no_run',
          message: `no stored eval run ${JSON.stringify(id)}; stored runs: ${stored.slice(-5).join(', ') || 'none'}`,
        };
      }
      const doc = readRun(store, String(id));
      if (!doc.ok) return doc;
      const root = repoRoot ?? resolve(ctx.cwd);
      const primary = ownerCheckoutOf(ctx.cwd) ?? root;
      const html = renderEvalReport(
        doc.run,
        findBaseline({ store, root }, doc.run).baseline,
        provenanceRefusal(doc.run, { root: primary, mainBranch: mainBranchOf(primary) })?.message ??
          null,
      );
      const dir =
        typeof input.out === 'string'
          ? isAbsolute(input.out)
            ? input.out
            : resolve(ctx.cwd, input.out)
          : join(store.root, 'reports');
      const roots = [store.root, repoRoot ?? ctx.cwd];
      const file = `eval-${id}.html`;
      const kind = { marker: MARKER, files: [file] };
      const problem = outputProblem(dir, roots, kind);
      if (problem) return { ok: false, error: 'output_path', message: problem };
      const real = writeReportFiles(dir, MARKER, { [file]: html });
      return {
        ok: true,
        run: id,
        html: join(real, file),
        gate_ok: doc.run.gate ? doc.run.gate.ok : null,
        text: `${join(real, file)}\n`,
      };
    },
  },
  {
    name: 'eval accept',
    summary:
      "Accept exactly a stored eval run as the baseline for its settings, without running again: writes evals/baselines/<mode>-<settings hash>.json in the primary checkout, for the owner to commit, and keeps a copy in the private store. The owner's decision (design part 17.9): executors never run it",
    built_by: 'g',
    mcp: false,
    args: [
      {
        name: 'result',
        type: 'string',
        required: true,
        description:
          'The run ID to accept, such as EV-20261114T031500Z-ab12cd. It must be a full, passing offline run that is not already the baseline',
      },
    ],
    run: (input, ctx) => {
      if (isExecutor(ctx)) return EXECUTOR_REFUSAL;
      const opened = openEvalStore(ctx);
      if (!opened.ok) return opened;
      const { store, stored } = opened;
      const id = input.result;
      if (typeof id !== 'string' || !RUN_ID.test(id) || !stored.includes(id)) {
        return {
          ok: false,
          error: 'no_run',
          message: `no stored eval run ${JSON.stringify(id)}; stored runs: ${stored.slice(-5).join(', ') || 'none'}`,
        };
      }
      const doc = readRun(store, id);
      if (!doc.ok) return doc;
      // The committed baseline is written to the primary checkout, never to a linked worktree.
      const root = ownerCheckoutOf(ctx.cwd) ?? resolve(ctx.cwd);
      const current = findBaseline({ store, root }, doc.run);
      const refusal = acceptRefusal(doc.run, current.baseline);
      if (refusal) {
        return {
          ok: false,
          error: 'refused',
          run: id,
          message: `run ${id} was not accepted: ${refusal}`,
        };
      }
      // A baseline judges main: the run must be of a commit on main, with a clean tree.
      const provenance = provenanceRefusal(doc.run, { root, mainBranch: mainBranchOf(root) });
      if (provenance) {
        return {
          ok: false,
          error: provenance.error,
          run: id,
          message: `run ${id} was not accepted: ${provenance.message}`,
        };
      }
      let written;
      try {
        written = acceptBaseline({ store, root, result: doc.run });
      } catch (e) {
        return {
          ok: false,
          error: 'refused',
          run: id,
          message: `run ${id} was not accepted: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      return {
        ok: true,
        run: id,
        baseline: join(store.root, written.key),
        committed: written.file,
        accepted: written.accepted,
        text: `${id} is now the baseline for settings ${doc.run.settings.settings_hash}\nwrote ${written.file}: commit it, so CI and every machine gate on it\n`,
      };
    },
  },
];
