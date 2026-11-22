// Actions for piece (f)'s scenarios: the dispatch gate and the report, over data given in the
// scenario (no store, no clock). A scenario names the declared limits, the usage snapshots and
// ledger entries, and the time; the policy is the defaults with the project's quota section.

import { readFileSync } from 'node:fs';
import { resolvePolicy } from '../../policy/policy.mjs';
import { dispatchGate } from '../../quota/gate.mjs';
import { buildReport, renderDigest, renderHtml } from '../../quota/report.mjs';
import { sandboxPath, writeSandboxFile } from '../util.mjs';

const COMMON = {
  quota: { type: 'object', description: 'Extra policy.quota settings: limits, reserve, ...' },
  snapshots: { type: 'array', items: { type: 'object' } },
  ledger: { type: 'array', items: { type: 'object' } },
  now: { type: 'string', minLength: 1 },
};

/** @param {Record<string, any>} input */
function policyOf(input) {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'scenario', key: 'W' },
    quota: input.quota ?? {},
  });
  if (!policy)
    throw new Error(`the scenario's quota section is invalid: ${JSON.stringify(errors)}`);
  return policy;
}

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'quota.gate': {
    description:
      'Ask the dispatch gate about an item at a time, over the limits, snapshots and ledger entries given. Returns the gate answer: mode, allow, reason, binding, forecast.',
    input: {
      type: 'object',
      properties: {
        ...COMMON,
        item: { type: 'object', description: '{ id, critical_path, estimate_tokens }' },
      },
      required: ['now'],
      additionalProperties: false,
    },
    run: (input) => {
      const { quotas, ...gate } = dispatchGate(
        policyOf(input),
        input.snapshots ?? [],
        input.item ?? {},
        { now: Date.parse(input.now), ledger: input.ledger ?? [] },
      );
      return {
        ...gate,
        quotas: quotas.map((q) => ({
          id: q.id,
          headroom: q.headroom,
          used: q.used,
          forecast: q.forecast,
        })),
      };
    },
  },
  'quota.report': {
    description:
      'Write dashboard.html and digest.txt under a sandbox directory for the quotas at a time. Returns the digest, the gate it shows, the forecast of each quota, and checks on the page: scripts, external references, dark-mode support.',
    input: {
      type: 'object',
      properties: { ...COMMON, dir: { type: 'string', minLength: 1 } },
      required: ['now', 'dir'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const policy = policyOf(input);
      const report = buildReport({
        policy,
        snapshots: input.snapshots ?? [],
        ledger: input.ledger ?? [],
        now: Date.parse(input.now),
      });
      const html = renderHtml(report);
      const digest = renderDigest(report);
      writeSandboxFile(sandboxPath(ctx.sandbox, `${input.dir}/dashboard.html`), html);
      writeSandboxFile(sandboxPath(ctx.sandbox, `${input.dir}/digest.txt`), digest);
      const onDisk = readFileSync(sandboxPath(ctx.sandbox, `${input.dir}/dashboard.html`), 'utf8');
      return {
        digest,
        gate: report.gate,
        forecasts: report.quotas.map((q) => ({ id: q.id, ...q.forecast })),
        page: {
          scripts: (onDisk.match(/<script/gi) ?? []).length,
          external_references:
            (onDisk.match(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//gi) ?? []).length +
            (onDisk.match(/url\(|@import/gi) ?? []).length,
          dark_mode: onDisk.includes('prefers-color-scheme:dark'),
          shows_forecast: onDisk.includes('Forecast that triggered it'),
        },
      };
    },
  },
};
