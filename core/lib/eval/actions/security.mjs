// Actions for the security gate's scenarios (design 10.5): a fixture repository with a fixture
// scanner, the merge queue with the security gate, and the verdict and accepted-risk records. The
// repository, the scanner and the private store all sit in the sandbox, the store beside the
// repository, never inside it.

import { openStore } from '../../store/store.mjs';
import { runMergeQueue } from '../../merge/queue.mjs';
import { securityGate } from '../../merge/security.mjs';
import { acceptRisk, expiredRisks, readRecords, recordVerdict } from '../../security/records.mjs';
import {
  SECURITY_MERGE_SETTINGS,
  buildSecurityRepo,
  securityPaths,
  writeFixtureScanner,
} from '../security-fixtures.mjs';

const FILES = {
  type: 'object',
  description: 'Files by path relative to the repository, and their text',
  additionalProperties: { type: 'string' },
};
const NOW = {
  type: 'string',
  description: 'The time the gate takes as now, ISO 8601 (default: the real time)',
};

/** @param {string | undefined} at */
const clock = (at) => (at ? () => new Date(at) : () => new Date());

/**
 * The pending finding at a path, which the queue sent a branch back with.
 * @param {string} sandbox @param {string} path
 */
function pendingAt(sandbox, path) {
  const r = readRecords(openStore(securityPaths(sandbox).store));
  const found = r.pending.find((e) => e.path === path);
  if (!found) throw new Error(`no pending finding at ${path}`);
  return found;
}

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'security.repo': {
    description:
      'Build the fixture repository: main with the given files, and branches each changing files, from main or from another branch. The fixture scanner, written outside the repository, reports each line under src/ that calls UNSAFE(. Returns { branches }.',
    input: {
      type: 'object',
      properties: {
        main: FILES,
        branches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              branch: { type: 'string', minLength: 1 },
              item: { type: 'string', pattern: '^[A-Z][A-Z0-9]*-[1-9][0-9]*$' },
              from: { type: 'string', minLength: 1 },
              files: FILES,
            },
            required: ['branch', 'item', 'files'],
            additionalProperties: false,
          },
        },
      },
      required: ['main', 'branches'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const p = securityPaths(ctx.sandbox);
      const { entries } = buildSecurityRepo(p.repo, { main: input.main, branches: input.branches });
      return { branches: entries.map((e) => e.branch) };
    },
  },

  'security.merge': {
    description:
      'Run the merge queue, with the security gate and the fixture scanner, over the named branches of the fixture repository. Returns { merged, rejected: [{ item, reason, findings: [{ key, rule, path, line }] }], baseline: { created, added, size }, fixed, decisions: [finding keys], main_moved }.',
    input: {
      type: 'object',
      properties: {
        branches: { type: 'array', items: { type: 'string' }, minItems: 1 },
        scanner_version: { type: 'string', minLength: 1 },
        now: NOW,
      },
      required: ['branches'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const p = securityPaths(ctx.sandbox);
      const scanner = writeFixtureScanner(p.scanner, { version: input.scanner_version });
      const gate = securityGate({
        store: openStore(p.store),
        scanners: [scanner],
        now: clock(input.now),
      });
      // Branches are named <prefix>/<item ID>-<slug>, as hitld env names them.
      const items = new Map(
        /** @type {string[]} */ (input.branches).map((b) => {
          const id = /^[^/]+\/([A-Z][A-Z0-9]*-[1-9][0-9]*)-/.exec(b)?.[1];
          if (!id) throw new Error(`branch ${b} is not named <prefix>/<item ID>-<slug>`);
          return [b, id];
        }),
      );
      const r = await runMergeQueue({
        repoRoot: p.repo,
        entries: [...items].map(([branch, item]) => ({ item, branch })),
        settings: { ...SECURITY_MERGE_SETTINGS, generated: [] },
        security: gate,
      });
      const s = /** @type {Record<string, any>} */ (gate.summary());
      return {
        merged: r.merged.map((m) => m.item),
        rejected: r.rejected.map((x) => ({
          item: x.item,
          reason: x.reason,
          findings: (x.findings ?? []).map((f) => ({
            key: f.key,
            rule: f.rule,
            path: f.path,
            line: f.line,
          })),
        })),
        baseline: { created: s.baseline.created, added: s.baseline.added, size: s.baseline.size },
        fixed: s.fixed.length,
        decisions: s.decisions.map((/** @type {{ finding: string }} */ d) => d.finding),
        decision_questions: s.decisions.map(
          (/** @type {{ question: { question: string } }} */ d) => d.question.question,
        ),
        main_moved: r.main.before !== r.main.after,
        incident: r.incident,
      };
    },
  },

  'security.verdict': {
    description:
      'Record a triage verdict for the pending finding at a path (the one the queue sent a branch back with). Returns { key, verdict }.',
    input: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        verdict: { enum: ['real', 'by-design', 'false-positive'] },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['path', 'verdict', 'reason'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const found = pendingAt(ctx.sandbox, input.path);
      const v = recordVerdict(openStore(securityPaths(ctx.sandbox).store), {
        key: found.key,
        verdict: input.verdict,
        reason: input.reason,
      });
      return { key: v.key, verdict: v.verdict };
    },
  },

  'security.accept': {
    description:
      "Record the owner's acceptance of the pending finding at a path as a risk until an expiry, as of now, citing a decision item. The tracker is a stand-in holding only that decision, as given (id, kind, state, answer). A refusal is data. Returns { accepted, key, expires, decision } or { accepted: false, refusal }.",
    input: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        expires: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        reason: { type: 'string', minLength: 1 },
        decision: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: '^[A-Z][A-Z0-9]*-[1-9][0-9]*$' },
            kind: { type: 'string' },
            state: { type: 'string' },
            answer: { type: 'string' },
          },
          required: ['id', 'kind', 'state'],
          additionalProperties: false,
        },
        now: NOW,
      },
      required: ['path', 'expires', 'reason', 'decision'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const found = pendingAt(ctx.sandbox, input.path);
      const d = /** @type {Record<string, unknown>} */ (input.decision);
      const tracker = {
        /** @param {string} id */
        get: (id) => {
          if (id !== d.id) throw new Error(`${id} is not in the tracker`);
          return d;
        },
      };
      try {
        const a = acceptRisk(openStore(securityPaths(ctx.sandbox).store), {
          key: found.key,
          expires: input.expires,
          reason: input.reason,
          decision: String(d.id),
          tracker,
          now: clock(input.now),
        });
        return { accepted: true, key: a.key, expires: a.expires, decision: a.decision };
      } catch (e) {
        return { accepted: false, refusal: /** @type {Error} */ (e).message };
      }
    },
  },

  'security.expired': {
    description:
      'The accepted risks past their expiry as of now: each is a decision for the owner. Returns { decisions: [finding keys] }.',
    input: {
      type: 'object',
      properties: { now: NOW },
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const r = readRecords(openStore(securityPaths(ctx.sandbox).store));
      return { decisions: expiredRisks(r, clock(input.now)()).map((e) => e.key) };
    },
  },
};
