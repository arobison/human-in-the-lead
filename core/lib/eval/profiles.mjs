// Harness profiles for the fake adapter (design part 17.7): the capability sets a scenario runs
// under, side by side. A scenario that needs a capability a profile lacks is not applicable
// under it, never passed.

import { FAKE_PROFILES } from '../../harness/fake/fake.mjs';
import { schemas } from '../schema/registry.mjs';
import { deepEqual } from './util.mjs';

/**
 * @typedef {import('../../harness/interface.mjs').HarnessCapabilities} HarnessCapabilities
 * @typedef {{ id: string, description: string, capabilities: HarnessCapabilities, constraints: Record<string, unknown> }} Profile
 */

/**
 * The Copilot cloud agent as the design describes it (part 17.7): one branch per task, a run-time
 * cap, tools-only MCP, a subset of hooks, no background completion, network behind an allowlist,
 * hosted classification limits. The capability values are the interface's reading of those
 * constraints; the Copilot adapter (the milestone Copilot adapter) confirms or corrects them. The constraints the
 * capability set cannot express are kept as data for the scenarios that check them.
 * @type {Profile}
 */
const COPILOT_CLOUD_AGENT = {
  id: 'copilot-cloud-agent',
  description: 'GitHub Copilot cloud agent: one branch per task, a run-time cap, tools-only MCP',
  capabilities: Object.freeze({
    parallel_subagents: false,
    persistent_sessions: false,
    worktrees: false,
    background_completion: false,
    remote_human_channel: true,
    hooks: 'subset',
    model_selection: true,
    effort_selection: false,
    usage_reporting: 'requests',
    max_classification: 'internal',
  }),
  constraints: Object.freeze({
    branchPerTask: true,
    runTimeCap: true,
    mcp: 'tools-only',
    network: 'allowlist',
  }),
};

/** @type {Readonly<Record<string, Profile>>} */
export const PROFILES = Object.freeze({
  full: {
    id: 'full',
    description: 'Everything available (the fake adapter default)',
    capabilities: FAKE_PROFILES.full,
    constraints: {},
  },
  minimal: {
    id: 'minimal',
    description: 'Nothing optional: the most degraded harness the core must still work with',
    capabilities: FAKE_PROFILES.minimal,
    constraints: {},
  },
  'copilot-cloud-agent': COPILOT_CLOUD_AGENT,
});

/** The profile name used for a scenario that drives no harness. */
export const NO_PROFILE = 'none';

/**
 * Whether a profile has what a scenario requires.
 * @param {HarnessCapabilities} capabilities
 * @param {Record<string, unknown>} requires capability name -> required value, or a list of acceptable values
 * @returns {string[]} what is missing, one line each; empty when the profile qualifies
 */
export function missingCapabilities(capabilities, requires) {
  /** @type {string[]} */
  const missing = [];
  for (const [name, want] of Object.entries(requires)) {
    const have = /** @type {Record<string, unknown>} */ (capabilities)[name];
    const acceptable = Array.isArray(want) ? want : [want];
    if (!acceptable.some((a) => deepEqual(a, have))) {
      missing.push(`${name}: needs ${JSON.stringify(want)}, has ${JSON.stringify(have)}`);
    }
  }
  return missing;
}

/**
 * Problems with a scenario's `requires`: names that are not capabilities.
 * @param {Record<string, unknown>} requires @returns {string[]}
 */
export function checkRequires(requires) {
  const known = Object.keys(schemas().get('harness-capabilities').properties);
  return Object.keys(requires)
    .filter((k) => !known.includes(k))
    .map((k) => `harness.requires.${k} is not a harness capability (${known.join(', ')})`);
}
