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
 * What a refused call line is told (HITLD-853): a call that is not reversible, a one-way one
 * among them, is not the executor's to make, so it is a decision item under `questions`.
 */
const NOT_REVERSIBLE =
  'every call is marked (reversible); a one-way call is not yours to make: put it under questions as a decision item (executor contract rule 5 in AGENTS.md)';

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
  else if (c) {
    const branch = c[2]?.trim();
    const problem = branch === undefined ? null : branchNameProblem(branch);
    if (problem) {
      errors.push(
        `commit names "${branch.slice(0, 80)}", which is not a valid branch name (${problem}): the line holds only "<sha> (branch <name>)"; a note about the branch goes under deviations`,
      );
    } else report.commit = { sha: c[1], ...(branch ? { branch } : {}) };
  } else errors.push(`commit must be "<sha> (branch <name>)" or "none": ${raw.commit}`);

  for (const f of ['evidence', 'bench_runs', 'deviations', 'questions']) {
    /** @type {string[]} */
    const entries = raw[f] ?? [];
    report[f] = entries.length === 1 && NONE.test(entries[0]) ? [] : entries;
  }
  /** @type {string[]} */
  const calls = !raw.calls || (raw.calls.length === 1 && NONE.test(raw.calls[0])) ? [] : raw.calls;
  report.calls = calls.map((/** @type {string} */ call) => {
    if (!REVERSIBLE.test(call)) {
      errors.push(`call not marked (reversible): ${call.slice(0, 80)}: ${NOT_REVERSIBLE}`);
    }
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

/**
 * Why `name` is not a branch name, or null when it is one: git's rules for a ref name
 * (git-check-ref-format), plus a leading "-", which git branch refuses, and ";", which git allows
 * but no branch the system makes holds, and which shows a note was written into the name
 * (HITLD-280).
 * @param {string} name
 * @returns {string | null}
 */
export function branchNameProblem(name) {
  if (name === '') return 'it is empty';
  if (name === '@') return 'it is "@"';
  if (/[\x00-\x20\x7f]/.test(name)) return 'it holds a space or a control character';
  const bad = /[~^:?*[\\;]/.exec(name);
  if (bad) return `it holds "${bad[0]}"`;
  if (name.startsWith('-')) return 'it starts with "-"';
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) {
    return 'it has an empty part between slashes';
  }
  if (name.includes('..')) return 'it holds ".."';
  if (name.includes('@{')) return 'it holds "@{"';
  if (name.endsWith('.')) return 'it ends with "."';
  for (const part of name.split('/')) {
    if (part.startsWith('.')) return 'a part starts with "."';
    if (part.endsWith('.lock')) return 'a part ends with ".lock"';
  }
  return null;
}
