// Event-driven cadences (design part 13.3): what recurring work is due, and why. The chief of
// staff runs `hitld cadence due` at its wakes (an owner message, an orchestrator's message, a
// check-in, a GitHub event) and runs what it lists. Nothing here keeps a timer or starts a job.

import { findRepoRoot } from '../../policy/policy.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { loadEffectivePolicy } from '../../settings/layers.mjs';
import { machineRootFor } from '../../env/manager.mjs';
import { readLedger } from '../../ledger/ledger.mjs';
import { quietState } from '../../rights/budget.mjs';
import { readTrustEvents } from '../../rights/trust.mjs';
import { dueJobs } from '../../cadence/due.mjs';
import { readIdle } from '../../cadence/idle.mjs';
import { markJobDone, readCadenceState } from '../../cadence/state.mjs';
import { executorSignal } from '../executor.mjs';

/** The jobs `hitld cadence` knows. */
const JOBS = ['digest', 'report', 'baseline', 'eval', 'sweep', 'review'];

/**
 * The policy, the private store and the clock, or the error to return.
 * @param {import('../table.mjs').CommandContext} ctx @param {Record<string, unknown>} input
 */
function gather(ctx, input) {
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
  return { error: null, loaded, policy: loaded.policy, store, now };
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'cadence due',
    summary:
      'What recurring work is due and why: digests and reports on thresholds, the owner writing or an idle machine (with a ceiling on silence), baselines and evals on an idle machine, the stale-item sweep after merges, calibration reviews on new outcomes. Reads only; the chief of staff runs what it lists',
    built_by: 'h',
    output: ['ok', 'now', 'idle', 'owner_present', 'due', 'held', 'waiting', 'ceiling_at', 'next'],
    args: [
      {
        name: 'owner-present',
        type: 'boolean',
        description:
          "The owner has just written in the chief of staff's session: a digest or report with something to say is due. Pass it only on the owner's own message",
      },
      {
        name: 'load',
        type: 'string',
        description:
          'The load average per core to judge idleness by. Default: this machine, now (the one-minute load average over its cores)',
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
      let loadPerCore;
      if (input.load !== undefined) {
        loadPerCore = Number(input.load);
        if (!Number.isFinite(loadPerCore) || loadPerCore < 0) {
          return { ok: false, error: 'usage', message: '--load is not a number' };
        }
      }
      const machineRoot = machineRootFor(g.store.root);
      const idle = readIdle({
        machineRoot,
        machine: g.loaded.layers?.machine ?? null,
        ...(loadPerCore !== undefined ? { loadPerCore } : {}),
      });
      const attention = g.loaded.settings?.attention;
      const quiet = attention ? quietState(g.now, attention.quiet_hours, attention.timezone) : null;
      const ownerPresent = input['owner-present'] === true;
      const ledger = readLedger(g.store);
      const result = dueJobs({
        policy: g.policy,
        events: ledger.events,
        origins: ledger.origins,
        trust: readTrustEvents(g.store),
        state: readCadenceState(g.store),
        idle,
        ownerPresent,
        now: g.now,
        quiet,
      });
      const names = result.due.map((d) => (d.person ? `${d.job} for ${d.person}` : d.job));
      return {
        ok: true,
        now: new Date(g.now).toISOString(),
        idle,
        owner_present: ownerPresent,
        ...result,
        ...(g.loaded.warnings.length ? { warnings: g.loaded.warnings.map((w) => w.message) } : {}),
        next: names.length
          ? `run ${names.join(', ')}: each entry's run commands, then its then steps (the last marks it done)`
          : result.held.length
            ? 'nothing to run now; held jobs wait for quiet hours to end, or for the owner to write'
            : 'nothing is due',
      };
    },
  },
  {
    name: 'cadence done',
    summary:
      'Mark a recurring job as run, so the next `cadence due` counts only what is newer. The chief of staff runs it after sending the digest or report, starting the baseline or evals, passing on the findings of the sweep, or building the review. Refused for an executor',
    built_by: 'h',
    output: ['ok', 'job', 'person', 'mark'],
    args: [
      {
        name: 'job',
        type: 'string',
        positional: true,
        required: true,
        description: `One of ${JOBS.join(', ')}`,
      },
      {
        name: 'person',
        type: 'string',
        description: 'For a review: whose (owner, or a contributor ID)',
      },
      {
        name: 'through',
        type: 'string',
        description:
          'The last ledger event the job read, as `cadence due` named it in `then` (none for an empty ledger). Default: the last event now',
      },
      {
        name: 'trust-through',
        type: 'integer',
        description:
          'How many trust events the job read, as `cadence due` named it. Default: all of them now',
      },
      {
        name: 'now',
        type: 'string',
        description: 'Mark at this time (a timestamp), for tests',
      },
    ],
    run: (input, ctx) => {
      const why = executorSignal(ctx.env, ctx.cwd);
      if (why) {
        return {
          ok: false,
          error: 'not-permitted',
          message: `an executor does not mark jobs done: ${why}`,
        };
      }
      const job = String(input.job);
      if (!JOBS.includes(job)) {
        return { ok: false, error: 'usage', message: `no job "${job}": ${JOBS.join(', ')}` };
      }
      const person = typeof input.person === 'string' ? input.person : undefined;
      if (job === 'review' && !person) {
        return { ok: false, error: 'usage', message: 'a review is per person: pass --person' };
      }
      if (job !== 'review' && person) {
        return { ok: false, error: 'usage', message: '--person is only for a review' };
      }
      const g = gather(ctx, input);
      if (g.error) return g.error;
      const ledger = readLedger(g.store);
      const events = ledger.events;
      /** @type {string | null} */
      let through = events.at(-1)?.id ?? null;
      if (typeof input.through === 'string') {
        if (input.through === 'none') through = null;
        else if (!events.some((e) => e.id === input.through)) {
          return {
            ok: false,
            error: 'usage',
            message: `--through ${input.through} is not an event in the ledger`,
          };
        } else through = input.through;
      }
      const trustCount = readTrustEvents(g.store).length;
      const trustThrough =
        typeof input['trust-through'] === 'number' ? input['trust-through'] : trustCount;
      if (trustThrough > trustCount) {
        return {
          ok: false,
          error: 'usage',
          message: `--trust-through ${trustThrough} is more than the ${trustCount} trust events recorded`,
        };
      }
      const key = job === 'review' ? `review:${person}` : job;
      // How many events of each ledger file the job had read, so an event another writer recorded
      // earlier that a later pull brings in still counts as new (HITLD-74).
      const mark = {
        at: new Date(g.now).toISOString(),
        through,
        trust_through: trustThrough,
        files: ledger.counts,
      };
      markJobDone(g.store, key, mark);
      return { ok: true, job, ...(person ? { person } : {}), mark };
    },
  },
];
