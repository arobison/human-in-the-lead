// A minimal SARIF reader and the code fingerprint (design part 10.5).
//
// Only the fields the gate needs are read: each run's tool (name and version), and each result's
// rule, location and message. Everything else in the file is ignored. SARIF suppressions and
// baselineState are ignored too: a finding the code under test marks as suppressed is still a
// finding, because nobody marks a finding "won't fix" silently.
//
// The fingerprint is computed here, from the file content at the location, not taken from the
// scanner: it survives the code moving to other lines, and changes when the code at that place
// changes, whatever the tool does.

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {object} RawResult a result as the SARIF file gives it
 * @property {string} rule
 * @property {string} path relative to the scanned directory, with forward slashes
 * @property {number} startLine 1-based; 0 when the result has no region
 * @property {number} endLine
 * @property {string} message
 * @property {string} level
 *
 * @typedef {{ tool: string, version: string, results: RawResult[] }} SarifRun
 *
 * @typedef {object} Finding a result with its fingerprint and key
 * @property {string} key the identity verdicts and the baseline use: tool, rule, fingerprint, occurrence
 * @property {string} tool
 * @property {string} version
 * @property {string} rule
 * @property {string} path
 * @property {number} line
 * @property {string} fingerprint
 * @property {'code' | 'message'} fingerprint_from 'message' when the file could not be read
 * @property {string} message
 * @property {string} level
 */

/** The largest SARIF file read, and the most results kept from one. */
export const MAX_SARIF_BYTES = 64 * 1024 * 1024;
export const MAX_RESULTS = 20_000;
/**
 * Lines of context either side of the flagged region that the fingerprint covers. None: an edit on
 * a neighbouring line, or lines inserted above, would otherwise ask again about unchanged code.
 */
export const CONTEXT_LINES = 0;
/** The most lines of a flagged region the fingerprint covers. */
const MAX_REGION_LINES = 20;
const MAX_MESSAGE = 300;
const SKIPPED_KINDS = new Set(['pass', 'notApplicable', 'informational']);

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} v @returns {string} */
const str = (v) => (typeof v === 'string' ? v : '');
/** @param {unknown} v @returns {number} */
const line = (v) => (Number.isInteger(v) && /** @type {number} */ (v) > 0 ? Number(v) : 0);
/** @param {string} s */
const sha = (s) => createHash('sha256').update(s).digest('hex');

/**
 * Read SARIF text. Throws, with a reason that quotes nothing from the file, when it is not SARIF.
 * @param {string} text
 * @returns {SarifRun[]}
 */
export function readSarif(text) {
  if (text.length > MAX_SARIF_BYTES) throw new Error('the SARIF output is too large');
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('the output is not JSON, so not SARIF');
  }
  if (!isObject(doc) || !Array.isArray(doc.runs)) {
    throw new Error('the output has no "runs" list, so it is not SARIF');
  }
  let count = 0;
  /** @type {SarifRun[]} */
  const runs = [];
  for (const run of doc.runs) {
    if (!isObject(run)) continue;
    const driver = isObject(run.tool) && isObject(run.tool.driver) ? run.tool.driver : {};
    const tool = str(driver.name).trim();
    if (!tool) throw new Error('a SARIF run has no tool.driver.name');
    const version = str(driver.semanticVersion) || str(driver.version);
    const rules = Array.isArray(driver.rules) ? driver.rules : [];
    /** @type {RawResult[]} */
    const results = [];
    for (const r of Array.isArray(run.results) ? run.results : []) {
      if (!isObject(r) || SKIPPED_KINDS.has(str(r.kind))) continue;
      if (++count > MAX_RESULTS)
        throw new Error(`the SARIF output has over ${MAX_RESULTS} results`);
      const index = Number.isInteger(r.ruleIndex)
        ? r.ruleIndex
        : isObject(r.rule)
          ? r.rule.index
          : -1;
      const rule =
        str(r.ruleId) ||
        (isObject(r.rule) ? str(r.rule.id) : '') ||
        (Number.isInteger(index) && isObject(rules[index]) ? str(rules[index].id) : '') ||
        '(no rule)';
      const loc = Array.isArray(r.locations) && isObject(r.locations[0]) ? r.locations[0] : {};
      const phys = isObject(loc.physicalLocation) ? loc.physicalLocation : {};
      const art = isObject(phys.artifactLocation) ? phys.artifactLocation : {};
      const region = isObject(phys.region) ? phys.region : {};
      const start = line(region.startLine);
      const message = isObject(r.message) ? str(r.message.text) : '';
      results.push({
        rule,
        path: str(art.uri),
        startLine: start,
        endLine: Math.max(start, line(region.endLine)),
        message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}...` : message,
        level: str(r.level) || 'warning',
      });
    }
    runs.push({ tool, version, results });
  }
  return runs;
}

/**
 * A SARIF location as a path relative to `root`, with forward slashes, or null when it lies
 * outside root or is not a file location.
 * @param {string} root @param {string} uri
 * @returns {string | null}
 */
export function relativePath(root, uri) {
  if (!uri) return null;
  let p = uri;
  try {
    if (/^file:/i.test(uri)) p = fileURLToPath(uri);
    else if (/^[a-z][a-z0-9+.-]*:/i.test(uri) && !/^[a-z]:[\\/]/i.test(uri)) return null;
    else p = decodeURIComponent(uri);
  } catch {
    return null;
  }
  const rel = relative(resolve(root), resolve(root, p));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

/**
 * The text of a file inside root, or null. The file is opened once without following a link at
 * its last component or blocking on a FIFO, and its real path must stay inside root: the code
 * under test chose these files, so a link must not lead the read elsewhere.
 * @param {string} root @param {string} rel
 * @returns {string | null}
 */
function readInside(root, rel) {
  let fd;
  try {
    const full = resolve(root, rel);
    const inside = relative(realpathSync(root), realpathSync(full));
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;
    fd = openSync(
      full,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0),
    );
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > 16 * 1024 * 1024) return null;
    return readFileSync(fd, 'utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The code at a place, normalized so that indentation and spacing changes do not change it: the
 * flagged lines and CONTEXT_LINES either side, each trimmed, runs of white space made one space.
 * @param {string} text @param {number} start @param {number} end
 */
export function codeWindow(text, start, end) {
  const lines = text.split(/\r?\n/);
  const last = Math.min(end, start + MAX_REGION_LINES - 1);
  const from = Math.max(1, start - CONTEXT_LINES);
  const to = Math.min(lines.length, last + CONTEXT_LINES);
  return lines
    .slice(from - 1, to)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .join('\n');
}

/**
 * Fingerprint and key every result of the runs, reading the files under `root`.
 * The key also counts occurrences: two results of one rule on the same code in one file get
 * different keys, in line order.
 * @param {SarifRun[]} runs @param {string} root the directory the scanner ran in
 * @returns {Finding[]}
 */
export function fingerprintRuns(runs, root) {
  /** @type {Map<string, string | null>} */
  const files = new Map();
  /** @type {Finding[]} */
  const out = [];
  for (const run of runs) {
    const sorted = run.results
      .map((r) => ({ ...r, path: relativePath(root, r.path) ?? r.path }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);
    /** @type {Map<string, number>} */
    const seen = new Map();
    for (const r of sorted) {
      if (!files.has(r.path)) {
        files.set(r.path, relativePath(root, r.path) === null ? null : readInside(root, r.path));
      }
      const text = files.get(r.path);
      const code =
        text != null && r.startLine > 0 ? codeWindow(text, r.startLine, r.endLine) : null;
      const fingerprint = sha(
        `${r.path}\n${code ?? `message:${r.message.replace(/\d+/g, '#')}`}`,
      ).slice(0, 16);
      const same = `${run.tool}\0${r.rule}\0${fingerprint}`;
      const occurrence = seen.get(same) ?? 0;
      seen.set(same, occurrence + 1);
      out.push({
        key: sha(`${same}\0${occurrence}`).slice(0, 12),
        tool: run.tool,
        version: run.version,
        rule: r.rule,
        path: r.path,
        line: r.startLine,
        fingerprint,
        fingerprint_from: code === null ? 'message' : 'code',
        message: r.message,
        level: r.level,
      });
    }
  }
  return out;
}
