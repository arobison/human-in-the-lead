// `hitld config migrate` (design part 13.4, moving from today's policy.json): propose the person
// and machine files from the moved keys that policy.json still sets, and the policy.json without
// them. Nothing becomes looser: a value already in a settings file is kept where it is stricter,
// and a project value that still narrows its home (a run budget, a relative worktree directory)
// stays in policy.json.

import { isAbsolute, relative } from 'node:path';
import { movedKeyWarnings, tightenLimit } from './layers.mjs';
import { stampLowest } from './versions.mjs';

/**
 * @typedef {object} MigrationInput
 * @property {Record<string, any>} raw policy.json as written
 * @property {Record<string, any> | null} person the current person file, if any
 * @property {Record<string, any> | null} machine the current machine file, if any
 *
 * @typedef {{ path: string, to: 'person' | 'machine' | 'policy.json' | 'dropped', value: unknown, note?: string }} Move
 *
 * @typedef {object} Migration
 * @property {Move[]} moves
 * @property {Record<string, any> | null} person the proposed person file; null when unchanged
 * @property {Record<string, any> | null} machine the proposed machine file; null when unchanged
 * @property {Record<string, any>} policy the proposed policy.json
 */

/** @param {Record<string, any>} obj @param {string} section @param {string} key */
function take(obj, section, key) {
  const value = obj[section]?.[key];
  if (obj[section]) {
    delete obj[section][key];
    if (Object.keys(obj[section]).length === 0) delete obj[section];
  }
  return value;
}

/** @param {Record<string, any>} obj @param {string} section @param {string} key @param {unknown} value */
function put(obj, section, key, value) {
  obj[section] ??= {};
  obj[section][key] = value;
}

/**
 * Propose the migration. Only keys that movedKeyWarnings flags are moved.
 * @param {MigrationInput} input
 * @returns {Migration}
 */
export function proposeMigration({ raw, person, machine }) {
  const policy = structuredClone(raw);
  const p = structuredClone(person ?? { schema_version: 1 });
  const m = structuredClone(machine ?? { schema_version: 1 });
  /** @type {Move[]} */
  const moves = [];
  const flagged = new Set(
    movedKeyWarnings({ raw, person, machine, project: {} }).map((w) => w.path),
  );

  for (const k of ['reserve', 'economize_below', 'critical_below', 'notify_used']) {
    if (!flagged.has(`quota.${k}`)) continue;
    const value = take(policy, 'quota', k);
    put(p, 'quota', k, value);
    moves.push({ path: `quota.${k}`, to: 'person', value });
  }
  if (flagged.has('quota.forecast_hours')) {
    const value = take(policy, 'quota', 'forecast_hours');
    if (p.quota?.forecast_hours === undefined) {
      put(p, 'quota', 'forecast_hours', value);
      moves.push({ path: 'quota.forecast_hours', to: 'person', value });
    } else {
      moves.push({
        path: 'quota.forecast_hours',
        to: 'dropped',
        value,
        note: 'the person file already sets it, so the project value had no effect',
      });
    }
  }
  if (flagged.has('quota.limits')) {
    /** @type {Record<string, any>[]} */
    const all = policy.quota.limits;
    const runs = all.filter((x) => x.window === 'run');
    const home = all.filter((x) => x.window !== 'run');
    /** @type {Record<string, any>[]} */
    const merged = structuredClone(p.quota?.limits ?? []);
    for (const limit of home) {
      const i = merged.findIndex((x) => x.id === limit.id);
      if (i < 0) merged.push(limit);
      else merged[i] = tightenLimit(merged[i], limit).limit;
      moves.push({ path: `quota.limits.${limit.id}`, to: 'person', value: limit });
    }
    put(p, 'quota', 'limits', merged);
    if (runs.length) {
      policy.quota.limits = runs;
      for (const r of runs) {
        moves.push({
          path: `quota.limits.${r.id}`,
          to: 'policy.json',
          value: r,
          note: 'a run budget stays with the project',
        });
      }
    } else take(policy, 'quota', 'limits');
  }
  for (const k of ['port_range', 'secret_provider']) {
    if (!flagged.has(`env.${k}`)) continue;
    const value = take(policy, 'env', k);
    put(m, 'env', k, value);
    moves.push({ path: `env.${k}`, to: 'machine', value });
  }
  if (flagged.has('env.worktree_root')) {
    const value = take(policy, 'env', 'worktree_root');
    const machineRoot = m.env?.worktree_root;
    if (machineRoot === undefined) {
      put(m, 'env', 'worktree_root', value);
      moves.push({ path: 'env.worktree_root', to: 'machine', value });
    } else {
      const rel = relative(machineRoot, value);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
        put(policy, 'env', 'worktree_root', rel);
        moves.push({
          path: 'env.worktree_root',
          to: 'policy.json',
          value: rel,
          note: "kept as a subdirectory under the machine's worktree root",
        });
      } else {
        moves.push({
          path: 'env.worktree_root',
          to: 'dropped',
          value,
          note: 'the machine file sets a worktree root this is not under, so it had no effect',
        });
      }
    }
  }
  const changed = (/** @type {unknown} */ before, /** @type {unknown} */ after) =>
    JSON.stringify(before) !== JSON.stringify(after);
  return {
    moves,
    person:
      changed(person, p) && moves.some((x) => x.to === 'person') ? stampLowest('person', p) : null,
    machine:
      changed(machine, m) && moves.some((x) => x.to === 'machine')
        ? stampLowest('machine', m)
        : null,
    policy,
  };
}
