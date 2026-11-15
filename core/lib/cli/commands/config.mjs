// Settings in four layers (design part 13.4): explain the effective values, write the person and
// machine files, and move settings out of policy.json.

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRepoRoot, loadPolicy, policyDefaults } from '../../policy/policy.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { loadState } from '../../run/checkpoint.mjs';
import {
  SETTINGS_KINDS,
  loadSettingsFile,
  settingsLocation,
  validateSettings,
  writeSettingsFile,
  writerRefusal,
} from '../../settings/files.mjs';
import { explainText, loadEffectivePolicy, setupState } from '../../settings/layers.mjs';
import { proposeMigration } from '../../settings/migrate.mjs';

const MAX_FILE_BYTES = 1_000_000;

/**
 * The current run's scope, if a run has started for this project.
 * @param {Record<string, any>} policy @param {import('../table.mjs').CommandContext} ctx
 * @returns {Record<string, any> | null}
 */
function runScope(policy, ctx) {
  try {
    const repoRoot = findRepoRoot(ctx.cwd) ?? undefined;
    const store = openStore(privateStorePath(policy.project.id, { env: ctx.env, repoRoot }));
    return loadState(store).state?.scope ?? null;
  } catch {
    return null;
  }
}

/**
 * The JSON to write: --data, or at the command line only, --file.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 * @returns {unknown}
 */
function dataInput(input, ctx) {
  const file = /** @type {string | undefined} */ (input.file);
  const text = /** @type {string | undefined} */ (input.data);
  if (file !== undefined && text !== undefined) throw new Error('give --data or --file, not both');
  if (file === undefined && text === undefined) throw new Error('--data or --file is required');
  let raw = /** @type {string} */ (text);
  if (file !== undefined) {
    // Deny by default: only the human command line sets `interactive`, so an agent calling through
    // MCP cannot make the tool read a path it names.
    if (ctx.interactive !== true) {
      throw new Error('--file is only available at the command line; pass --data');
    }
    try {
      // Trust boundary: the person at the command line names this file; its JSON is validated.
      const path = resolve(ctx.cwd, file);
      if (statSync(path).size > MAX_FILE_BYTES) throw new Error('large');
      raw = readFileSync(path, 'utf8');
    } catch {
      throw new Error('--file must name a readable file (under 1 MB)');
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${file !== undefined ? '--file' : '--data'} is not valid JSON`);
  }
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'config explain',
    summary:
      'Each effective setting, the layer it came from (person, machine, project, run or default), and any looser value it overrode',
    piece: 'settings-hold',
    args: [
      {
        name: 'json',
        type: 'boolean',
        description: 'Return the values as data, for skills, instead of text lines',
      },
    ],
    run: (input, ctx) => {
      const policyResult = loadPolicy({ cwd: ctx.cwd });
      const noPolicy = !policyResult.policy && policyResult.path === null;
      // Outside a project, the project layer is the defaults, so the person and machine files can
      // still be explained.
      const base = noPolicy
        ? {
            ...policyResult,
            policy: { ...policyDefaults(), project: { id: 'none', key: 'X' } },
            raw: {},
            errors: [],
          }
        : policyResult;
      const run = base.policy ? runScope(base.policy, ctx) : null;
      const r = loadEffectivePolicy({
        env: ctx.env,
        policyResult: base,
        run: noPolicy ? null : run,
      });
      const ok = r.errors.length === 0;
      const files = {
        ...r.files,
        policy: noPolicy ? { path: null, present: false } : r.files.policy,
      };
      const setup = setupState(files);
      if (!r.settings) return { ok, files, setup, errors: r.errors, warnings: r.warnings };
      if (input.json) {
        return {
          ok,
          files,
          setup,
          cap: r.settings.cap,
          values: r.settings.values,
          warnings: r.warnings,
          errors: r.errors,
        };
      }
      return {
        ok,
        text: explainText(r.settings.values) + (setup.reason ? `\n\n${setup.reason}` : ''),
        files,
        setup,
        warnings: r.warnings.map((w) => w.message),
        errors: r.errors,
      };
    },
  },
  {
    name: 'config write',
    summary:
      'Validate and write the person or machine settings file; refused for executors (HITLD_ROLE=executor or HITLD_DISPATCH set)',
    piece: 'settings-hold',
    args: [
      {
        name: 'kind',
        type: 'string',
        positional: true,
        required: true,
        description: 'person or machine',
      },
      { name: 'data', type: 'string', description: 'The settings as JSON' },
      {
        name: 'file',
        type: 'string',
        mcp: false,
        description: 'A file holding the settings as JSON (command line only)',
      },
      {
        name: 'merge',
        type: 'boolean',
        description:
          'Merge into the current file (objects key by key; arrays replace) instead of replacing it',
      },
      { name: 'check', type: 'boolean', description: 'Validate only; write nothing' },
    ],
    run: (input, ctx) => {
      const kind = /** @type {import('../../settings/files.mjs').SettingsKind} */ (input.kind);
      if (!SETTINGS_KINDS.includes(kind)) {
        return { ok: false, error: 'usage', message: '<kind> is person or machine' };
      }
      const refusal = writerRefusal(ctx.env, ctx.cwd);
      if (refusal) {
        return {
          ok: false,
          error: 'refused',
          message: `executors never write settings: ${refusal}`,
        };
      }
      const data = dataInput(input, ctx);
      if (input.check) {
        const errors = validateSettings(kind, data);
        return {
          ok: errors.length === 0,
          path: settingsLocation(kind, { env: ctx.env }).path,
          errors,
        };
      }
      const written = writeSettingsFile(kind, data, {
        env: ctx.env,
        cwd: ctx.cwd,
        merge: input.merge === true,
      });
      return { ok: true, written: true, ...written };
    },
  },
  {
    name: 'config migrate',
    summary:
      'Propose person and machine files from the settings that moved out of policy.json, and rename settings that HITLD-82 renamed in all three files; with --yes, write them and remove the moved keys from policy.json',
    piece: 'settings-hold',
    args: [
      {
        name: 'yes',
        type: 'boolean',
        description:
          'Write the proposal: the settings files, then policy.json without the moved keys',
      },
    ],
    run: (input, ctx) => {
      const loaded = loadPolicy({ cwd: ctx.cwd });
      if (!loaded.policy || !loaded.path) {
        return {
          ok: false,
          error: 'policy',
          message: 'policy.json is missing or invalid; run hitld check policy',
          errors: loaded.errors,
        };
      }
      const person = loadSettingsFile('person', { env: ctx.env });
      const machine = loadSettingsFile('machine', { env: ctx.env });
      const errors = [...person.errors, ...machine.errors];
      if (errors.length) {
        return { ok: false, error: 'settings', message: 'a settings file does not load', errors };
      }
      const plan = proposeMigration({
        raw: loaded.raw ?? {},
        person: person.data,
        machine: machine.data,
      });
      // Settings read under their names before HITLD-82: the files are rewritten in the new names.
      for (const [file, renamed] of /** @type {const} */ ([
        ['policy.json', loaded.renamed ?? []],
        ['person', person.renamed ?? []],
        ['machine', machine.renamed ?? []],
      ])) {
        for (const r of renamed) {
          plan.moves.push({ path: r.from, to: file, value: r.to, note: `renamed to ${r.to}` });
        }
      }
      if (!plan.person && person.renamed?.length) plan.person = person.data;
      if (!plan.machine && machine.renamed?.length) plan.machine = machine.data;
      const proposal = {
        moves: plan.moves,
        person: plan.person && { path: person.path, data: plan.person },
        machine: plan.machine && { path: machine.path, data: plan.machine },
        policy: { path: loaded.path, data: plan.policy },
      };
      if (!plan.moves.length) {
        return {
          ok: true,
          written: false,
          message: 'nothing to move: policy.json sets no moved keys',
          ...proposal,
        };
      }
      if (!input.yes) {
        return {
          ok: true,
          written: false,
          message: 'a proposal; run again with --yes to write it',
          ...proposal,
        };
      }
      const refusal = writerRefusal(ctx.env, ctx.cwd);
      if (refusal) {
        return {
          ok: false,
          error: 'refused',
          message: `executors never write settings: ${refusal}`,
        };
      }
      const opts = { env: ctx.env, cwd: ctx.cwd };
      if (plan.person) writeSettingsFile('person', plan.person, opts);
      if (plan.machine) writeSettingsFile('machine', plan.machine, opts);
      // Trust boundary: the path is the policy.json loadPolicy found and read through trusted
      // loading; the content is that file with keys removed.
      writeFileSync(loaded.path, JSON.stringify(plan.policy, null, 2) + '\n');
      return {
        ok: true,
        written: true,
        message: 'written; review the change to policy.json and commit it',
        ...proposal,
      };
    },
  },
];
