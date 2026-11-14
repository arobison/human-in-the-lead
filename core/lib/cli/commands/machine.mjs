// The machine profile (design part 13.4): detect what this machine has and propose a profile.

import { localSources, probeMachine, proposeProfile } from '../../machine/detect.mjs';
import {
  loadSettingsFile,
  settingsLocation,
  writeSettingsFile,
  writerRefusal,
} from '../../settings/files.mjs';

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'machine detect',
    summary:
      'Probe this machine (cores, memory, GPUs, browsers, operating system, role) from local sources only and print a proposed profile; writes nothing unless --write',
    piece: 'settings-hold',
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
      const p = proposeProfile(probe, current.data);
      const path = settingsLocation('machine', { env: ctx.env }).path;
      const base = {
        path,
        role: p.role,
        role_source: p.role_source,
        role_hints: probe.role_hints,
        confirmation: p.confirm
          ? 'a person confirms the role and each value; run again with --write to accept, or edit the values and use config write'
          : `${p.role} sessions record the profile without asking: run with --write at session start`,
        proposed: p.profile,
        warnings: p.warnings,
      };
      if (!input.write) return { ok: true, written: false, ...base };
      const refusal = writerRefusal(ctx.env, ctx.cwd);
      if (refusal) {
        return {
          ok: false,
          error: 'refused',
          message: `executors never write settings: ${refusal}`,
          ...base,
          written: false,
        };
      }
      const written = writeSettingsFile('machine', p.profile, { env: ctx.env, cwd: ctx.cwd });
      return { ok: true, ...base, written: true, path: written.path };
    },
  },
];
