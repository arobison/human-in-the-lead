// Actions for piece (h)'s scenarios: sizing, the dispatch-refill cycle against the profile's fake
// adapter, the merge queue on a fixture repository, and the orchestrator's and chief of staff's
// commands in a fixture consumer (for kill and resume, hand-over, and the watchdog and quota pauses,
// on a clock the scenario moves forward). Every repository is built inside the sandbox; the
// private store sits beside it, never inside it.

import { join } from 'node:path';
import { resolvePolicy } from '../../policy/policy.mjs';
import { openStore } from '../../store/store.mjs';
import { readLedger } from '../../ledger/ledger.mjs';
import { startRun } from '../../run/run.mjs';
import { sizeItem } from '../../dispatch/sizing.mjs';
import { runDispatchLoop } from '../../dispatch/loop.mjs';
import { runMergeQueue } from '../../merge/queue.mjs';
import {
  approvalEvents,
  approvePresented,
  chooseNamed,
  presentToOwner,
} from '../../merge/owner.mjs';
import { readTrustEvents, recordTrustEvent } from '../../rights/trust.mjs';
import { recordStatusLine } from '../../../harness/claude-code/statusline.mjs';
import {
  MERGE_SETTINGS,
  buildConsumer,
  buildMergeRepo,
  fakeWorkstation,
  writeSetupDone,
  fixtureGit,
} from '../orchestrator-fixtures.mjs';

/** @param {Record<string, unknown>} [extra] */
function policyOf(extra = {}) {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'scenario', key: 'W' },
    ...extra,
  });
  if (!policy) throw new Error(`the scenario's policy is invalid: ${JSON.stringify(errors)}`);
  return policy;
}

const ITEMS = {
  type: 'array',
  items: { type: 'object' },
  description:
    'Items as the tracker gives them: id, kind, state, classification, touches, body, ...',
};

/** @type {Record<string, unknown>} */
const CLOCK = {
  type: 'integer',
  minimum: 0,
  description:
    'Run as if this many seconds have passed since the step ran, for the watchdog and quota resets; time otherwise passes as it does',
};

/** A clock this many seconds ahead of the real one. @param {number} seconds */
const clockAt = (seconds) => () => new Date(Date.now() + seconds * 1000);

/** @param {string} id */
const doneReport = (id) =>
  `item: ${id}\nresult: done\ncommit: abc1234 (branch hitld/${id})\nevidence:\n  - npm test: passed\nbench_runs: none\ndeviations: none\ncalls: none\nquestions: none\n`;

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'orchestrator.size': {
    description:
      'Size items into tiers with the default policy plus the given sections. Returns { sizes: { <id>: { tier, reasons, estimate_tokens } } }.',
    input: {
      type: 'object',
      properties: { items: ITEMS, policy: { type: 'object' } },
      required: ['items'],
      additionalProperties: false,
    },
    run: (input) => {
      const policy = policyOf(input.policy);
      /** @type {Record<string, unknown>} */
      const sizes = {};
      for (const it of input.items) {
        const s = sizeItem(it, policy);
        sizes[String(it.id)] = {
          tier: s.tier,
          reasons: s.reasons,
          estimate_tokens: s.estimate_tokens,
        };
      }
      return { sizes };
    },
  },

  'orchestrator.cycle': {
    description:
      "Run the dispatch-refill cycle over the items against the profile's fake adapter, each executor finishing with a done report. Returns { dispatches, max_running, remaining, order, waits, reported, in_flight }.",
    input: {
      type: 'object',
      properties: { items: ITEMS, cap: { type: 'integer', minimum: 1 } },
      required: ['items'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const fake = ctx.adapter();
      const store = openStore(join(ctx.sandbox, 'cycle-store'));
      const run = startRun(store, { session: 'eval', host: 'eval' });
      // Each executor finishes on the next turn of the event loop: a completion notice.
      /** @type {import('../../../harness/interface.mjs').HarnessAdapter} */
      const adapter = {
        ...fake,
        async dispatch(request) {
          const handle = await fake.dispatch(request);
          setImmediate(() =>
            fake.complete(request.dispatch, {
              report: doneReport(request.item),
              usage: { tokens: 1000, toolCalls: 2, durationMs: 10 },
            }),
          );
          return handle;
        },
      };
      const items = structuredClone(input.items);
      const r = await runDispatchLoop({ run, adapter, policy: policyOf(), items, cap: input.cap });
      ctx.recordTokens(0);
      return {
        dispatches: r.dispatches,
        max_running: r.maxRunning,
        within_cap: r.maxRunning <= (fake.capabilities().parallel_subagents ? (input.cap ?? 3) : 1),
        remaining: r.remaining,
        order: r.trace.filter((t) => t.step === 'dispatch').map((t) => t.item),
        waits: fake.calls.filter((c) => c.method === 'onComplete').length,
        reported: readLedger(store).events.filter((e) => e.event === 'reported').length,
        in_flight: run.state.in_flight.length,
      };
    },
  },

  'orchestrator.merge': {
    description:
      'Build the merge fixture repository (four branches: one good with a generated-file change, one that breaks the suite, one with a conflicting generated-file change, one with a semantic conflict; or, with flaky, one branch and a test that fails once, or with flaky alternating, one that fails on every other run on main too) and run the merge queue. With owner, the branches wait for the owner: only those named in only are merged, and with none named nothing is. Returns the queue result with main_files, the regenerated gen/files.txt on main.',
    input: {
      type: 'object',
      properties: {
        flaky: { enum: [true, false, 'alternating'] },
        owner: { type: 'boolean' },
        only: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const { root, entries } = buildMergeRepo(join(ctx.sandbox, 'merge-repo'), {
        flaky: input.flaky === 'alternating' ? 'alternating' : input.flaky === true,
        marker: join(ctx.sandbox, 'flake-marker'),
      });
      const owner = input.owner === true;
      const chosen = owner
        ? chooseNamed(entries, /** @type {string[]} */ (input.only ?? [])).chosen
        : entries;
      const r = await runMergeQueue({
        repoRoot: root,
        entries: chosen,
        settings: { ...MERGE_SETTINGS, generated: [...MERGE_SETTINGS.generated] },
      });
      return {
        waiting: entries.length - r.merged.length - r.rejected.length,
        merged: r.merged.map((m) => m.item),
        rejected: r.rejected.map((x) => ({ item: x.item, reason: x.reason, files: x.files ?? [] })),
        flakes: r.flakes.length,
        flake_outcomes: r.flakes.map((f) => f.outcome),
        suite_runs: r.suite_runs,
        bisection_runs: r.bisection_runs,
        bisected: r.bisection_runs > 0,
        batches: r.batches,
        incident: r.incident,
        main_moved: r.main.before !== r.main.after,
        main_files: fixtureGit(root, 'show', 'main:gen/files.txt'),
        main_head_tested: r.main.after === fixtureGit(root, 'rev-parse', 'main'),
      };
    },
  },

  'orchestrator.owner-merge': {
    description:
      "Build the merge fixture repository (as orchestrator.merge) and run owner merge mode on it: the queue checks every branch without moving main and presents the green ones; then the owner's answer, all or a list, is applied and each approval recorded as a trust event in a sandbox store. Returns { presented, question, rejected, main_moved_before_approval, merged, approval_suite_runs, checked_again, main_head_tested, approvals: [{ subject, as_presented }], reads }.",
    input: {
      type: 'object',
      properties: {
        approve: {
          description: 'The owner\'s answer: "all", or the branches or items named',
          anyOf: [{ const: 'all' }, { type: 'array', items: { type: 'string' } }],
        },
      },
      required: ['approve'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const { root, entries } = buildMergeRepo(join(ctx.sandbox, 'merge-repo'));
      const store = openStore(join(ctx.sandbox, 'owner-store'));
      const settings = { ...MERGE_SETTINGS, generated: [...MERGE_SETTINGS.generated] };
      const policy = policyOf({ merge: { mode: 'owner' } });
      const before = fixtureGit(root, 'rev-parse', 'main');
      const shown = await presentToOwner({ repoRoot: root, entries, settings, policy });
      const p = shown.presentation;
      const afterChecks = fixtureGit(root, 'rev-parse', 'main');
      const rejected = [...(shown.queued?.rejected ?? []), ...(shown.checked?.rejected ?? [])];
      /** @type {Awaited<ReturnType<typeof approvePresented>> | null} */
      let approved = null;
      if (p) {
        approved = await approvePresented({
          repoRoot: root,
          presentation: p,
          all: input.approve === 'all',
          names: Array.isArray(input.approve) ? input.approve : [],
          entries,
          settings,
        });
        if (approved.result) {
          const at = new Date();
          for (const ev of approvalEvents(p, approved.result.merged, approved.as_presented, at)) {
            recordTrustEvent(store, ev, at.toISOString());
          }
        }
      }
      return {
        presented: (p?.branches ?? []).map((b) => b.item),
        question: p?.question ?? null,
        rejected: rejected.map((x) => ({ item: x.item, reason: x.reason })),
        main_moved_before_approval: afterChecks !== before,
        merged: (approved?.result?.merged ?? []).map((m) => m.item),
        approval_suite_runs: approved?.result?.suite_runs ?? null,
        checked_again: approved?.rechecked ?? null,
        main_head_tested:
          approved?.result != null &&
          fixtureGit(root, 'rev-parse', 'main') === approved.result.main.after,
        approvals: readTrustEvents(store).map((e) => ({
          subject: e.subject,
          as_presented: e.as_presented,
        })),
        reads: (p?.branches ?? []).reduce((n, b) => n + b.reads.length, 0),
      };
    },
  },

  'orchestrator.consumer': {
    description:
      'Build a fixture consumer repository at consumer/ in the sandbox (three items; W-3 needs W-1) and record a status-line usage snapshot with headroom. Returns { root }.',
    input: {
      type: 'object',
      properties: {
        policy: {
          type: 'object',
          description:
            "Policy sections over the fixture's own, such as orchestrator or merge (merged at the top level)",
        },
        setup: {
          type: 'boolean',
          description:
            'Write empty person and machine files, as a finished first-run setup leaves them (default true; the scenario must not use a repo fixture, whose policy.json at the sandbox root makes the sandbox a managed project that refuses settings files). false leaves them missing',
        },
      },
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const root = buildConsumer(join(ctx.sandbox, 'consumer'), {
        ...(input.policy ? { policy: input.policy } : {}),
      });
      const env = {
        XDG_DATA_HOME: join(ctx.sandbox, 'data'),
        XDG_CONFIG_HOME: join(ctx.sandbox, 'config'),
      };
      if (input.setup !== false) writeSetupDone(env);
      const now = Math.floor(Date.now() / 1000);
      const status = recordStatusLine(
        JSON.stringify({
          session_id: 'eval',
          workspace: { project_dir: root },
          rate_limits: {
            five_hour: { used_percentage: 10, resets_at: now + 3600 },
            seven_day: { used_percentage: 20, resets_at: now + 86400 },
          },
        }),
        { cwd: root, env },
      );
      return { root: 'consumer', snapshot: status.recorded };
    },
  },

  'orchestrator.statusline': {
    description:
      "Record a status-line usage reading in the fixture consumer, as the session's status line would: the five-hour window's used percentage and when it resets, on the scenario's clock. Returns { recorded }.",
    input: {
      type: 'object',
      properties: {
        five_hour_used: { type: 'number', minimum: 0, maximum: 100 },
        resets_in_seconds: {
          type: 'integer',
          minimum: 1,
          description: 'When the five-hour window resets, in seconds after the clock below',
        },
        clock_offset_seconds: CLOCK,
      },
      required: ['five_hour_used', 'resets_in_seconds'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const root = join(ctx.sandbox, 'consumer');
      const now = clockAt(input.clock_offset_seconds ?? 0);
      const at = Math.floor(now().getTime() / 1000);
      const status = recordStatusLine(
        JSON.stringify({
          session_id: 'eval',
          workspace: { project_dir: root },
          rate_limits: {
            five_hour: {
              used_percentage: input.five_hour_used,
              resets_at: at + input.resets_in_seconds,
            },
            seven_day: { used_percentage: 20, resets_at: at + 7 * 86400 },
          },
        }),
        {
          cwd: root,
          env: {
            XDG_DATA_HOME: join(ctx.sandbox, 'data'),
            XDG_CONFIG_HOME: join(ctx.sandbox, 'config'),
          },
          now,
        },
      );
      return { recorded: status.recorded };
    },
  },

  'orchestrator.owner-turns': {
    description:
      'Script the owner side of a conversation, one entry per owner message. A reply in the "values" phase must be "yes to all" or one or more "change N to X" (separated by commas or semicolons), the forms the first-run walk-through accepts; any other reply fails the step. Returns { turns, values_turns, replies }.',
    input: {
      type: 'object',
      properties: {
        turns: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              phase: { enum: ['values', 'status_line'] },
              say: { type: 'string', minLength: 1 },
            },
            required: ['phase', 'say'],
            additionalProperties: false,
          },
        },
      },
      required: ['turns'],
      additionalProperties: false,
    },
    run: (input) => {
      const accepted = /^(yes to all|change \d+ to .+)$/i;
      /** @type {{ phase: string, say: string }[]} */
      const turns = input.turns;
      for (const t of turns) {
        if (t.phase !== 'values') continue;
        const parts = t.say.split(/\s*[;,]\s*(?=change \d+ to )/i);
        if (!parts.every((p) => accepted.test(p.trim()))) {
          throw new Error(`the owner reply "${t.say}" is not "yes to all" or "change N to X"`);
        }
      }
      return {
        turns: turns.length,
        values_turns: turns.filter((t) => t.phase === 'values').length,
        replies: turns.map((t) => t.say),
      };
    },
  },

  'orchestrator.cli': {
    description:
      'Run a hitld command in the fixture consumer as an orchestrator session (session defaults to "first"), or, with as_executor, as a dispatched executor. Returns { exit, result }.',
    input: {
      type: 'object',
      properties: {
        argv: { type: 'array', items: { type: 'string' }, minItems: 1 },
        session: { type: 'string', minLength: 1 },
        fake_machine: {
          type: 'boolean',
          description:
            'Probe a fake workstation (8 cores, 16 GB, a desktop session) instead of the machine the eval runs on',
        },
        as_executor: {
          type: 'boolean',
          description: 'Run as a dispatched executor would: HITLD_DISPATCH and HITLD_ROLE are set',
        },
        clock_offset_seconds: CLOCK,
      },
      required: ['argv'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const { main } = await import('../../cli/main.mjs');
      let out = '';
      const exit = await main(input.argv, {
        out: (t) => (out += t),
        err: () => {},
        cwd: join(ctx.sandbox, 'consumer'),
        ...(input.fake_machine ? { machine: fakeWorkstation() } : {}),
        ...(input.clock_offset_seconds ? { now: clockAt(input.clock_offset_seconds) } : {}),
        env: {
          ...(input.as_executor ? { HITLD_ROLE: 'executor', HITLD_DISPATCH: 'D-1' } : {}),
          XDG_DATA_HOME: join(ctx.sandbox, 'data'),
          XDG_CONFIG_HOME: join(ctx.sandbox, 'config'),
          HITLD_SESSION: input.session ?? 'first',
          PATH: process.env.PATH,
        },
      });
      /** @type {unknown} */
      let result;
      try {
        result = JSON.parse(out);
      } catch {
        result = { text: out };
      }
      return { exit, result };
    },
  },
};
