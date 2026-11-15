// The executor report (design part 5.6): parse the fixed text shape into data, and name every way
// the text departs from it. Pure; the `Stop` hook and the orchestrator's report check call it.

import { schemas } from '../schema/registry.mjs';

const FIELDS = [
  'item',
  'result',
  'commit',
  'evidence',
  'bench_runs',
  'deviations',
  'calls',
  'questions',
];
const LISTS = new Set(['evidence', 'bench_runs', 'deviations', 'calls', 'questions']);
/**
 * The field names before HITLD-82, read with a warning until the next minor release: a report
 * from an executor whose contract block predates the change.
 */
const OLD_FIELDS = /** @type {Record<string, string>} */ ({ status: 'result', runs: 'bench_runs' });
const NONE = /^none$/i;
const REVERSIBLE = /\s*\(reversible\)\.?\s*$/i;

/**
 * Parse a report. `report` is the parsed data when there are no errors, else null.
 * One surrounding code fence is tolerated; any other text outside the shape is an error.
 * A field under its name before HITLD-82 (`status`, `runs`) is read as the new one, with a
 * warning.
 * @param {string} text
 * @returns {{ report: Record<string, any> | null, errors: string[], warnings: string[] }}
 */
export function parseReport(text) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  let lines = String(text).replace(/\r\n?/g, '\n').trim().split('\n');
  if (lines.length >= 2 && /^```/.test(lines[0]) && lines.at(-1)?.trim() === '```') {
    lines = lines.slice(1, -1);
  }
  /** @type {Record<string, any>} */
  const raw = {};
  /** @type {string | null} */
  let open = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const bullet = /^\s+-\s+(.*\S)\s*$/.exec(line);
    if (bullet) {
      if (open && Array.isArray(raw[open])) raw[open].push(bullet[1]);
      else errors.push(`a list entry outside a list field: ${line.trim()}`);
      continue;
    }
    const head = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    const old = head ? OLD_FIELDS[head[1]] : undefined;
    if (!head || !(FIELDS.includes(head[1]) || old)) {
      errors.push(`unexpected line: ${line.trim().slice(0, 80)}`);
      open = null;
      continue;
    }
    if (old) warnings.push(`${head[1]} is now ${old}: update the contract block (hitld install)`);
    const name = old ?? head[1];
    const value = head[2];
    if (name in raw) {
      errors.push(`${name} appears twice`);
      open = null;
      continue;
    }
    if (LISTS.has(name)) {
      raw[name] = value === '' ? [] : [value];
      open = name;
    } else {
      raw[name] = value;
      open = null;
    }
  }
  for (const f of FIELDS) if (!(f in raw)) errors.push(`${f} is missing`);

  /** @type {Record<string, any>} */
  const report = { item: raw.item, result: raw.result };
  const c = /^([0-9a-f]+)(?:\s+\((?:branch\s+)?([^)]+)\))?$/i.exec(raw.commit ?? '');
  if (raw.commit === undefined) report.commit = null;
  else if (NONE.test(raw.commit)) report.commit = null;
  else if (c) report.commit = { sha: c[1], ...(c[2] ? { branch: c[2].trim() } : {}) };
  else errors.push(`commit must be "<sha> (branch <name>)" or "none": ${raw.commit}`);

  for (const f of ['evidence', 'bench_runs', 'deviations', 'questions']) {
    /** @type {string[]} */
    const entries = raw[f] ?? [];
    report[f] = entries.length === 1 && NONE.test(entries[0]) ? [] : entries;
  }
  /** @type {string[]} */
  const calls = !raw.calls || (raw.calls.length === 1 && NONE.test(raw.calls[0])) ? [] : raw.calls;
  report.calls = calls.map((/** @type {string} */ call) => {
    if (!REVERSIBLE.test(call)) errors.push(`call not marked (reversible): ${call.slice(0, 80)}`);
    return { text: call.replace(REVERSIBLE, ''), reversible: true };
  });

  if (errors.length) return { report: null, errors, warnings };
  const checked = schemas().validate('report', report);
  if (checked.length) {
    return {
      report: null,
      errors: checked.map((e) => `${e.path || 'report'}: ${e.message}`),
      warnings,
    };
  }
  return { report, errors: [], warnings };
}
