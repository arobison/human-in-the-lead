// The machine profile (design part 13.4): detect what this machine has and propose a profile.

import { localSources, probeMachine, proposeProfile } from '../../machine/detect.mjs';
import { DEFAULT_RUNS, runNoiseTest, writeNoiseResult } from '../../machine/noise.mjs';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { projectStore, readStoreSettings } from '../../settings/store-copy.mjs';
import {
  loadSettingsFile,
  machineDir,
  settingsLocation,
  writeSettingsFile,
  writerRefusal,
} from '../../settings/files.mjs';

/**
 * The owner's answers about this kind of machine from the project's store, with the kind, or null
 * when there is no project, no answers for this kind, or the store was not brought up to date.
 * @param {string} kind @param {import('../table.mjs').CommandContext} ctx
 * @returns {Record<string, any> | null}
 */
function storeAnswers(kind, ctx) {
  const loaded = loadPolicy({ cwd: ctx.cwd });
  if (!loaded.policy || !loaded.path) return null;
  const projectId = loaded.policy.project.id;
  const repoRoot = findRepoRoot(ctx.cwd) ?? undefined;
  const store = projectStore(projectId, { env: ctx.env, repoRoot });
  const s = readStoreSettings(store, { projectId, env: ctx.env });
  const answers = s.state === 'read' ? s.machine?.[kind] : undefined;
  return answers ? { kind, ...answers } : null;
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'machine detect',
    summary:
      'Probe this machine (cores, memory, GPUs, browsers, operating system, kind of machine) from local sources only and print a proposed profile; writes nothing unless --write',
    built_by: 'settings-hold',
    args: [
      {
        name: 'write',
        type: 'boolean',
        description:
          'Confirm the proposal and write it to the machine file through the same path as config write (refused for executors). A cloud VM or CI session writes at its start without asking',
      },
    ],
    run: (input, ctx) => {
      const probe = probeMachine(ctx.machine ?? localSources());
      const current = loadSettingsFile('machine', { env: ctx.env });
      if (current.errors.length) {
        return {
          ok: false,
          error: 'settings',
          message: 'the machine file does not load; fix it, or move it aside, then detect again',
          errors: current.errors,
        };
      }
      // No machine file here (a fresh container): the owner's answers about this kind of machine,
      // kept in the project's store (HITLD-148), are used in place of asking again.
      const answers = current.data ? null : storeAnswers(probe.role, ctx);
      const p = proposeProfile(probe, current.data ?? answers);
      const path = settingsLocation('machine', { env: ctx.env }).path;
      const base = {
        path,
        kind: p.role,
        kind_source: answers ? 'store' : p.role_source,
        ...(answers ? { from_store: Object.keys(answers).filter((k) => k !== 'kind') } : {}),
        kind_hints: probe.role_hints,
        confirmation: p.confirm
          ? 'a person confirms the kind of machine and each value; run again with --write to accept, or edit the values and use config write'
          : `${p.role} sessions record the profile without asking: run with --write at session start`,
        proposed: p.profile,
        warnings: p.warnings,
      };
      if (!input.write) return { ok: true, written: false, ...base };
      const refusal = writerRefusal(ctx.env, ctx.cwd);
      if (refusal) {
        return {
          ok: false,
          error: 'not-permitted',
          message: refusal,
          ...base,
          written: false,
        };
      }
      const written = writeSettingsFile('machine', p.profile, { env: ctx.env, cwd: ctx.cwd });
      return { ok: true, ...base, written: true, path: written.path };
    },
  },
  {
    name: 'machine noise',
    summary:
      'Check whether the background-priority work running now leaves a measurement alone: time a fixed CPU-bound workload several times, report how far the timings spread and how much background work ran (macOS reads priorities), and keep the result for env status. The evidence for load.ignore_background in the machine file',
    built_by: 'settings-hold',
    args: [
      {
        name: 'runs',
        type: 'integer',
        description: `Timed runs, at least 3; default ${DEFAULT_RUNS}`,
      },
    ],
    run: (input, ctx) => {
      const runs = typeof input.runs === 'number' ? input.runs : undefined;
      if (runs !== undefined && runs < 3) {
        return { ok: false, error: 'usage', message: '--runs is at least 3' };
      }
      const result = runNoiseTest({ ...(runs !== undefined ? { runs } : {}) });
      const path = writeNoiseResult(machineDir({ env: ctx.env }), result);
      return {
        ok: true,
        ...result,
        path,
        next:
          result.verdict === 'quiet'
            ? 'background work left the timings alone; load.ignore_background in the machine file may be turned on (hitld config write machine)'
            : result.verdict === 'noisy'
              ? 'leave load.ignore_background off: background work moved the timings'
              : 'this run settles nothing; run it again while background work runs, on macOS',
      };
    },
  },
];
