// The merge queue's security scans (design parts 10.5 and 14.2), kept apart from queue.mjs so the
// queue only calls it: `check` after a branch's fast checks, `merged` after main moves.
//
// Each declared scanner runs on the rebased branch. A finding that is in neither the baseline nor
// the recorded verdicts (nor an accepted risk) sends the branch back with the finding. When the
// baseline does not hold a tool version yet, that scanner runs once on main first and its findings
// extend the baseline: the first scan creates it instead of failing. After a batch merges, the
// baseline findings the merged code no longer has are removed.

import {
  classify,
  expiredRiskQuestion,
  expiredRisks,
  extendBaseline,
  knowsTool,
  readRecords,
  recordPending,
  removeFixed,
  saveBaseline,
} from '../security/records.mjs';
import { runScanner } from '../security/scan.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 * @typedef {import('../security/scan.mjs').Scanner} Scanner
 * @typedef {import('../security/scan.mjs').ScanResult} ScanResult
 * @typedef {import('../security/scan.mjs').RunScanner} RunScanner
 *
 * @typedef {{ key: string, tool: string, rule: string, path: string, line: number, message: string, recorded_real?: boolean }} SentBack
 * @typedef {{ ok: true } | { ok: false, findings: SentBack[], command?: string, output?: string }} SecurityCheck
 *
 * @typedef {object} SecurityGate
 * @property {(c: { dir: string, commit: string, base: string, item: string, branch: string,
 *   checkout: (sha: string) => void }) => SecurityCheck} check
 *   scan the rebased branch checked out at `dir`; `base` is main, for a baseline it lacks
 * @property {(c: { dir: string, commit: string, checkout: (sha: string) => void }) => void} merged
 *   main now holds `commit`: drop the baseline findings it fixed
 * @property {() => Record<string, unknown>} summary
 */

/**
 * @param {{ store: PrivateStore, scanners: Scanner[], run?: RunScanner, now?: () => Date }} o
 * @returns {SecurityGate}
 */
export function securityGate(o) {
  const run = o.run ?? runScanner;
  const now = o.now ?? (() => new Date());
  /** @type {import('../security/records.mjs').Records | null} */
  let records = null;
  const load = () => (records ??= readRecords(o.store));
  /** Scans of main, at most one per scanner per queue run. @type {Set<string>} */
  const mainScanned = new Set();
  /** The scans of each branch commit, for `merged`. @type {Map<string, ScanResult[]>} */
  const scans = new Map();
  /** @type {{ created: boolean, added: number, tools: string[] }} */
  const baseline = { created: false, added: 0, tools: [] };
  /** @type {string[]} */
  const fixed = [];
  let sentBack = 0;

  return {
    check({ dir, commit, base, item, branch, checkout }) {
      if (!o.scanners.length) return { ok: true };
      const r = load();
      /** @type {ScanResult[]} */
      const results = [];
      /** @type {SentBack[]} */
      const fresh = [];
      /** @type {import('../security/sarif.mjs').Finding[]} */
      const pending = [];
      for (const scanner of o.scanners) {
        const res = run(scanner, dir);
        if (!res.ok) return { ok: false, findings: [], command: res.command, output: res.output };
        if (res.tools.some((t) => !knowsTool(r, t)) && !mainScanned.has(scanner.name)) {
          mainScanned.add(scanner.name);
          checkout(base);
          const onMain = run(scanner, dir);
          checkout(commit);
          if (!onMain.ok) {
            throw new Error(
              `the scanner ${scanner.name} failed on main, so the baseline cannot be made: ${onMain.output}`,
            );
          }
          const ext = extendBaseline(r, onMain, { commit: base, now });
          baseline.created ||= ext.created;
          baseline.added += ext.added;
          baseline.tools.push(...ext.tools);
          saveBaseline(o.store, r);
        }
        results.push(res);
        for (const f of classify(res.findings, r, now()).new) {
          pending.push(f);
          fresh.push({
            key: f.key,
            tool: f.tool,
            rule: f.rule,
            path: f.path,
            line: f.line,
            message: f.message,
            ...(f.recorded_real ? { recorded_real: true } : {}),
          });
        }
      }
      scans.set(commit, results);
      if (!fresh.length) return { ok: true };
      recordPending(o.store, pending, { item, branch, now });
      sentBack++;
      return { ok: false, findings: fresh };
    },

    merged({ dir, commit, checkout }) {
      if (!o.scanners.length) return;
      const r = load();
      if (r.baseline === null) return;
      let results = scans.get(commit);
      if (!results) {
        checkout(commit);
        results = o.scanners.map((s) => run(s, dir));
      }
      let changed = false;
      for (const res of results) {
        if (!res.ok) continue;
        const removed = removeFixed(r, res);
        fixed.push(...removed);
        changed ||= removed.length > 0;
      }
      if (changed) saveBaseline(o.store, r);
    },

    summary() {
      if (!o.scanners.length) return { scanners: 0 };
      const r = load();
      const decisions = expiredRisks(r, now()).map((risk) => ({
        finding: risk.key,
        expired: risk.expires,
        question: expiredRiskQuestion(risk),
      }));
      return {
        scanners: o.scanners.length,
        baseline: { ...baseline, size: r.baseline?.length ?? 0 },
        fixed,
        sent_back: sentBack,
        decisions,
        ...(decisions.length
          ? {
              next: 'an accepted risk has expired: put each decision to the owner with hitld rights ask --question <its question>',
            }
          : {}),
      };
    },
  };
}
