// A throwaway project for tests: a repository with a policy.json, a private store outside it, a
// stand-in tracker, and a precedent store, wired as piece (e)'s library takes them.

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePolicy, policyHash, POLICY_PATH } from '../../lib/policy/policy.mjs';
import { openStore, privateStorePath } from '../../lib/store/store.mjs';
import { openPrecedentStore } from '../../lib/precedent/store.mjs';
import { createMemoryTracker } from './memory-tracker.mjs';

/** The areas the tests use: two with owners, one without. */
export const AREAS = [
  {
    name: 'cache',
    paths: ['src/cache/**'],
    owners: ['C-3'],
    may_decide: ['novelty', 'blast-radius', 'conflicting-evidence'],
  },
  { name: 'api', paths: ['src/api/**'], owners: ['C-4'], may_decide: ['blast-radius'] },
  { name: 'docs', paths: ['docs/**'] },
];

/**
 * @param {{ rights?: Record<string, any>, areas?: Record<string, any>[] | null }} [options]
 * @returns {Omit<import('../../lib/rights/flow.mjs').Deps, 'tracker'> & { tracker: import('./memory-tracker.mjs').MemoryTracker, root: string, env: NodeJS.ProcessEnv, policyRaw: object, tick: () => string }}
 */
export function makeProject(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hitld-rights-'));
  mkdirSync(join(root, '.git'));
  const data = mkdtempSync(join(tmpdir(), 'hitld-rights-data-'));
  const env = { XDG_DATA_HOME: data };
  const policyRaw = {
    schema_version: 1,
    project: { id: 'fixture', key: 'W' },
    rights: { areas: options.areas === null ? [] : (options.areas ?? AREAS), ...options.rights },
  };
  const { policy, errors } = resolvePolicy(policyRaw);
  if (!policy) throw new Error(JSON.stringify(errors));
  mkdirSync(join(root, '.human-in-the-lead'));
  const file = join(root, POLICY_PATH);
  writeFileSync(file, JSON.stringify(policyRaw));
  chmodSync(file, 0o644);
  const store = openStore(privateStorePath('fixture', { env, repoRoot: root }));
  let t = Date.parse('2026-11-14T10:00:00Z');
  const tick = () => new Date((t += 60_000)).toISOString();
  return {
    root,
    env,
    policyRaw,
    policy,
    policyHash: policyHash(policy),
    tracker: createMemoryTracker(),
    precedents: openPrecedentStore({
      repoRoot: root,
      store,
      ceiling: policy.project.classification_ceiling,
    }),
    store,
    now: tick,
    tick,
  };
}
