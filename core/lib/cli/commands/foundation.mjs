// Commands the foundation builds.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadPolicy } from '../../policy/policy.mjs';
import { worktreeSetupGap } from '../../env/setup-gap.mjs';
import { DEVICES_MOVED } from '../../store/placement.mjs';
import { loadEffectivePolicy } from '../../settings/layers.mjs';
import { schemas } from '../../schema/registry.mjs';
import { NAME, VERSION } from '../../version.mjs';

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'version',
    summary: 'The plugin version, the Node version, and the schema version of each data format',
    built_by: 'foundation',
    args: [],
    run: () => {
      const registry = schemas();
      return {
        ok: true,
        name: NAME,
        version: VERSION,
        node: process.version,
        schema_versions: Object.fromEntries(
          registry.versionedIds().map((id) => [id, registry.currentVersion(id)]),
        ),
      };
    },
  },
  {
    name: 'check policy',
    aliases: ['policy check'],
    summary:
      "Validate .human-in-the-lead/policy.json merged with the defaults: no unknown or code-running keys, values within bounds, and neither the private store's address nor its device list in the project's repository",
    built_by: 'foundation',
    args: [
      {
        name: 'policy',
        type: 'string',
        description:
          'Path to policy.json. Default: .human-in-the-lead/policy.json here or in a parent directory',
      },
      {
        name: 'effective',
        type: 'boolean',
        description: 'Also print the effective policy: the file merged with the defaults',
      },
    ],
    run: (input, ctx) => {
      const result = loadPolicy({
        path: /** @type {string | undefined} */ (input.policy),
        cwd: ctx.cwd,
      });
      // The device list never sits beside policy.json (design 0003, section 6).
      const devicesFile = result.path ? join(dirname(result.path), 'store-devices.json') : null;
      if (devicesFile && existsSync(devicesFile)) {
        result.errors = [
          ...result.errors,
          { path: '.human-in-the-lead/store-devices.json', message: DEVICES_MOVED },
        ];
      }
      // Keys that moved to the person or machine file still load, with a warning (design 13.4).
      const warnings = result.policy
        ? loadEffectivePolicy({ env: ctx.env, policyResult: result }).warnings.map((w) => w.message)
        : [];
      // Checks the merge queue would run in a worktree its setup leaves empty (HITLD-292).
      const gap = result.path
        ? worktreeSetupGap(result.policy, dirname(dirname(result.path)))
        : null;
      if (gap) warnings.push(gap);
      return {
        ok: result.errors.length === 0,
        path: result.path,
        hash: result.hash,
        errors: result.errors,
        ...(warnings.length ? { warnings } : {}),
        ...(input.effective && result.policy ? { policy: result.policy } : {}),
      };
    },
  },
];
