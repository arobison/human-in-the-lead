// The executor contract block in a consuming project's AGENTS.md (design parts 5.2 and 15.2):
// render it from the template, find it between its markers, say how it differs from the current
// one, and write it without touching any text outside the markers.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../version.mjs';

export const TEMPLATE_PATH = fileURLToPath(
  new URL('../../../templates/AGENTS.contract.md', import.meta.url),
);

const BEGIN = /^<!-- hitld:contract begin v(\S+) -->[ \t]*$/;
const END = /^<!-- hitld:contract end -->[ \t]*$/;

/** The ID key shown in the block's example when the project's is not known. */
export const DEFAULT_KEY = 'W';
const KEY = /^[A-Z][A-Z0-9]{0,9}$/;

/** The key a block's example shows for a project key: the key itself, or the fallback. @param {string} key */
const renderedKey = (key) => (KEY.test(key) ? key : DEFAULT_KEY);

/** The first line of an AGENTS.md that install creates: markdownlint MD041 wants a top-level heading. */
export const NEW_FILE_HEADING = '# Agent instructions';

/**
 * A block with its blank lines dropped: formatters such as prettier add or remove blank lines
 * around the markers and between blocks, and that is not an edit (HITLD-256).
 * @param {string} body
 */
const withoutBlankLines = (body) =>
  body
    .split('\n')
    .filter((l) => l.trim() !== '')
    .join('\n');

/**
 * The block for a plugin version and project key: markers included, one trailing newline.
 * @param {string} [version]
 * @param {string} [key] the project's ID key (policy.json project.key), shown in the example
 */
export function renderBlock(version = VERSION, key = DEFAULT_KEY) {
  const k = renderedKey(key);
  return (
    readFileSync(TEMPLATE_PATH, 'utf8')
      .replaceAll('{{VERSION}}', version)
      .replaceAll('{{KEY}}', k)
      .trimEnd() + '\n'
  );
}

/**
 * Where the block is in a text.
 * @typedef {{ state: 'missing' } | { state: 'malformed', problem: string }
 *   | { state: 'found', version: string, start: number, end: number, body: string }} Found
 * `start` and `end` are line indexes of the markers; `body` is the whole block, markers included.
 * @param {string} text
 * @returns {Found}
 */
export function findBlock(text) {
  const lines = text.split('\n');
  /** @type {number[]} */
  const begins = [];
  /** @type {number[]} */
  const ends = [];
  lines.forEach((l, i) => {
    if (BEGIN.test(l)) begins.push(i);
    else if (END.test(l)) ends.push(i);
  });
  if (!begins.length && !ends.length) return { state: 'missing' };
  if (begins.length !== 1 || ends.length !== 1) {
    return {
      state: 'malformed',
      problem: `expected one begin and one end marker, found ${begins.length} and ${ends.length}`,
    };
  }
  const [start] = begins;
  const [end] = ends;
  if (end < start) return { state: 'malformed', problem: 'the end marker comes before the begin' };
  const version = /** @type {RegExpExecArray} */ (BEGIN.exec(lines[start]))[1];
  return {
    state: 'found',
    version,
    start,
    end,
    body: lines.slice(start, end + 1).join('\n') + '\n',
  };
}

/**
 * Check a text's block against the plugin's.
 * @param {string} text
 * @param {string} [version]
 * @param {string} [key]
 * @returns {{ status: 'current' | 'missing' | 'outdated' | 'modified' | 'malformed', found?: string, expected: string, message: string, drift?: string[] }}
 */
export function compareBlock(text, version = VERSION, key = DEFAULT_KEY) {
  const found = findBlock(text);
  const fix = 'run hitld install';
  if (found.state === 'missing') {
    return { status: 'missing', expected: version, message: `no contract block; ${fix}` };
  }
  if (found.state === 'malformed') {
    return {
      status: 'malformed',
      expected: version,
      message: `${found.problem}; repair the markers by hand, then ${fix}`,
    };
  }
  if (found.version !== version) {
    return {
      status: 'outdated',
      found: found.version,
      expected: version,
      message: `the block is v${found.version}, the plugin is v${version}; ${fix}`,
    };
  }
  const want = renderBlock(version, key);
  if (withoutBlankLines(found.body) === withoutBlankLines(want))
    return { status: 'current', found: found.version, expected: version, message: 'current' };
  // A block rendered while the policy's key was invalid has the fallback key in its example; once
  // the key is fixed that is a stale rendering, not an edit by hand (HITLD-933).
  const fallback = renderBlock(version, DEFAULT_KEY);
  if (fallback !== want && withoutBlankLines(found.body) === withoutBlankLines(fallback)) {
    return {
      status: 'outdated',
      found: found.version,
      expected: version,
      message: `the block's example was rendered with the fallback key ${DEFAULT_KEY}, not the project's key ${renderedKey(key)}; ${fix} renders it with ${renderedKey(key)}`,
    };
  }
  const have = new Set(found.body.split('\n'));
  const wanted = new Set(want.split('\n'));
  const drift = [
    ...want
      .split('\n')
      .filter((l) => l && !have.has(l))
      .map((l) => `missing: ${l}`),
    ...found.body
      .split('\n')
      .filter((l) => l && !wanted.has(l))
      .map((l) => `changed or added: ${l}`),
  ];
  return {
    status: 'modified',
    found: found.version,
    expected: version,
    message: `the block was edited by hand (${drift.length} lines differ); ${fix} restores it`,
    drift,
  };
}

/**
 * Write or update the block in `<dir>/AGENTS.md`. Text outside the markers is never changed: a
 * missing block is appended after one blank line; a present one is replaced in place, unless it
 * differs from the plugin's only in blank lines. A new or empty file starts with a top-level
 * heading. A file with broken markers is refused.
 * @param {string} dir
 * @param {string} [version]
 * @param {string} [key]
 * @returns {{ ok: boolean, action: 'created' | 'added' | 'updated' | 'unchanged' | 'refused', path: string, message?: string }}
 */
export function installBlock(dir, version = VERSION, key = DEFAULT_KEY) {
  const path = join(dir, 'AGENTS.md');
  const block = renderBlock(version, key);
  const fresh = `${NEW_FILE_HEADING}\n\n${block}`;
  if (!existsSync(path)) {
    writeFileSync(path, fresh);
    return { ok: true, action: 'created', path };
  }
  const text = readFileSync(path, 'utf8');
  const found = findBlock(text);
  if (found.state === 'malformed') {
    return { ok: false, action: 'refused', path, message: found.problem };
  }
  if (
    found.state === 'found' &&
    found.version === version &&
    withoutBlankLines(found.body) === withoutBlankLines(block)
  ) {
    return { ok: true, action: 'unchanged', path };
  }
  let next;
  if (found.state === 'missing') {
    next = text.trim() === '' ? fresh : text.replace(/\n*$/, '\n\n') + block;
  } else {
    const lines = text.split('\n');
    next = [
      ...lines.slice(0, found.start),
      ...block.trimEnd().split('\n'),
      ...lines.slice(found.end + 1),
    ].join('\n');
  }
  if (next === text) return { ok: true, action: 'unchanged', path };
  writeFileSync(path, next);
  return { ok: true, action: found.state === 'missing' ? 'added' : 'updated', path };
}

/**
 * Does a CLAUDE.md import AGENTS.md (a line `@AGENTS.md`)?
 * @param {string} text
 */
export const importsAgents = (text) => /^\s*@AGENTS\.md\s*$/m.test(text);
