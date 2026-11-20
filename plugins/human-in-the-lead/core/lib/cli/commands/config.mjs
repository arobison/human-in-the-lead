// Settings in four layers (design part 13.4): explain the effective values, write the person and
// machine files, and move settings out of policy.json.

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRepoRoot, loadPolicy, mergePolicy, policyDefaults } from '../../policy/policy.mjs';
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
import {
  personLayer,
  projectStore,
  readStoreSettings,
  MACHINE_KEY,
  PERSON_KEY,
  storeWriteRefusal,
  writeStoreSettings,
} from '../../settings/store-copy.mjs';
import { cloudSession } from '../../store/reach.mjs';
import { pinnedProjects } from '../../settings/pins.mjs';
import { pinWarnings } from '../../settings/versions.mjs';
import { readLedger } from '../../ledger/ledger.mjs';
import { activePause, pauseGate } from '../../quota/pause.mjs';
import { machineRootFor } from '../../env/manager.mjs';
import { runningElsewhere } from '../../registry/machine.mjs';

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
 * After a settings write: when this project's run is paused at the quota gate, whether the new
 * settings let dispatch go again (a raised limit or a smaller reserve). The orchestrator re-plans
 * at once instead of waiting for the reset; this session does not hold the lease, so it records
 * nothing (design part 12.5). Null when there is no paused run here.
 * @param {import('../table.mjs').CommandContext} ctx
 */
function replanAfterWrite(ctx) {
  try {
    const loaded = loadPolicy({ cwd: ctx.cwd });
    if (!loaded.policy) return null;
    const repoRoot = findRepoRoot(ctx.cwd) ?? undefined;
    const projectId = loaded.policy.project.id;
    const store = openStore(privateStorePath(projectId, { env: ctx.env, repoRoot }));
    const state = loadState(store).state;
    if (!state) return null;
    const active = activePause(readLedger(store).events);
    if (!active) return null;
    const machineRoot = machineRootFor(store.root);
    const layered = loadEffectivePolicy({
      env: ctx.env,
      policyResult: loaded,
      run: state.scope,
      running: runningElsewhere(machineRoot, projectId),
    });
    if (!layered.policy) return null;
    const gate = pauseGate({
      policy: layered.policy,
      store,
      machineRoot,
      person: layered.layers?.person ?? null,
      state,
      now: (ctx.now ?? (() => new Date()))().getTime(),
    });
    const lifts = gate.mode !== 'stop';
    return {
      paused: { limit: active.limit, resets_at: active.resets_at, since: active.at },
      gate: { mode: gate.mode, reason: gate.reason },
      lifts,
      next: lifts
        ? 'the new settings let dispatch go again: wake the session holding the lease now (hitld run status names wake_to) with "budget raised"; its hitld dispatch plan re-plans and records the resume'
        : `dispatch stays paused: ${gate.reason}`,
    };
  } catch {
    return null;
  }
}

/**
 * The project here and its private store, or null outside a project.
 * @param {import('../table.mjs').CommandContext} ctx
 * @returns {{ projectId: string, store: string } | null}
 */
function projectHere(ctx) {
  const loaded = loadPolicy({ cwd: ctx.cwd });
  if (!loaded.policy || !loaded.path) return null;
  const projectId = loaded.policy.project.id;
  const repoRoot = findRepoRoot(ctx.cwd) ?? undefined;
  const store = projectStore(projectId, { env: ctx.env, repoRoot });
  return store ? { projectId, store } : null;
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

/**
 * Warnings for the projects pinned on this machine that cannot read the person or machine file as
 * it is (design part 16.5).
 * @param {Record<string, any> | null | undefined} layers the loaded person and machine data
 * @param {import('../table.mjs').CommandContext} ctx @param {string | undefined} project
 * @returns {{ path: string, home: 'person' | 'machine', message: string }[]}
 */
function versionWarnings(layers, ctx, project) {
  const pins = pinnedProjects({ cwd: ctx.cwd, env: ctx.env, project });
  return /** @type {const} */ (['person', 'machine']).flatMap((kind) =>
    pinWarnings(kind, layers?.[kind] ?? null, pins).map((message) => ({
      path: `${kind}.schema_version`,
      home: kind,
      message: `the ${kind} file: ${message}`,
    })),
  );
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'config explain',
    summary:
      'Each effective setting, the layer it came from (person, machine, project, run or default), and any looser value it overrode',
    built_by: 'settings-hold',
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
      const warnings = [
        ...r.warnings,
        ...versionWarnings(r.layers, ctx, noPolicy ? undefined : base.policy?.project?.id),
      ];
      const files = {
        ...r.files,
        policy: noPolicy ? { path: null, present: false } : r.files.policy,
      };
      const setup = setupState(files);
      if (!r.settings) return { ok, files, setup, errors: r.errors, warnings };
      if (input.json) {
        return {
          ok,
          files,
          setup,
          cap: r.settings.cap,
          attention: r.settings.attention,
          values: r.settings.values,
          warnings,
          errors: r.errors,
        };
      }
      return {
        ok,
        text:
          explainText(r.settings.values) +
          (setup.from_store.length
            ? `\n\nfrom the project's store: ${setup.from_store.join(' and ')}`
            : '') +
          (setup.conservative ? `\n\n${setup.conservative}` : '') +
          (setup.reason ? `\n\n${setup.reason}` : ''),
        files,
        setup,
        warnings: warnings.map((w) => w.message),
        errors: r.errors,
      };
    },
  },
  {
    name: 'config write',
    summary:
      "Validate and write the person or machine settings file, and in a project put what travels (the person settings; the owner's answers about this kind of machine) in the project's private store for the next store push; refused for executors (HITLD_ROLE=executor or HITLD_DISPATCH set)",
    built_by: 'settings-hold',
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
          error: 'not-permitted',
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
      // The project's store holds the settings that travel (HITLD-148). When it is expected and
      // not up to date here, nothing is written: a write would start from a stale copy, or from a
      // container's leftover file, and the next push would spread it. A merge starts from the
      // person settings this session uses, which may have come from the store.
      const here = projectHere(ctx);
      const fromStore = here
        ? readStoreSettings(here.store, { projectId: here.projectId, env: ctx.env })
        : null;
      // In a cloud session the person file in the container is set aside while the store is not
      // read, so a write would change nothing this session uses and could spread a stale copy:
      // nothing is written. On the person's own machine, their file is written and the store's
      // copy is left as it is, with the reason.
      const stale = fromStore ? storeWriteRefusal(fromStore) : null;
      if (stale && cloudSession(ctx.env)) {
        return {
          ok: false,
          error: 'settings-not-pulled',
          message: `nothing was written: ${stale}`,
        };
      }
      let next = data;
      let merge = input.merge === true;
      if (merge && kind === 'person' && fromStore) {
        const local = loadSettingsFile('person', { env: ctx.env });
        const layer = personLayer(local.data, fromStore, ctx.env);
        // A merge never starts from a local file the session set aside (only in a cloud session,
        // which the refusal above already covers).
        if (layer.ignored) {
          return {
            ok: false,
            error: 'settings-not-pulled',
            message: `nothing was written: ${stale ?? 'the person file is set aside'}`,
          };
        }
        if (layer.source === 'store' || layer.source === 'store-and-file') {
          next = mergePolicy(layer.person ?? {}, /** @type {Record<string, any>} */ (data));
          merge = false;
        }
      }
      const written = writeSettingsFile(kind, next, { env: ctx.env, cwd: ctx.cwd, merge });
      // Written in the owner's own turn (writeSettingsFile refuses executors); the next
      // hitld store push carries it to the remote.
      const store = !here
        ? null
        : stale
          ? {
              key: kind === 'person' ? PERSON_KEY : MACHINE_KEY,
              written: false,
              error: 'settings-not-pulled',
              why: `the store's copy was not written: ${stale}`,
            }
          : {
              ...writeStoreSettings(kind, written.data, here.store),
              next: 'hitld store push carries it to the store remote, so a new session reads it',
            };
      const replan = replanAfterWrite(ctx);
      return {
        ok: true,
        written: true,
        ...written,
        ...(store ? { store } : {}),
        ...(replan ? { replan } : {}),
      };
    },
  },
  {
    name: 'config migrate',
    summary:
      'Propose person and machine files from the settings that moved out of policy.json, and rename settings that HITLD-82 renamed in all three files; with --yes, write them and remove the moved keys from policy.json',
    built_by: 'settings-hold',
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
          error: 'not-permitted',
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
