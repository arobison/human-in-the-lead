// The error codes of the `hitld` command (design part 16.2): one map, lowercase kebab-case, and
// every code the command table can return is in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, KEBAB_CASE, isErrorCode } from '../lib/cli/errors.mjs';
import { COMMANDS } from '../lib/cli/table.mjs';
import { main } from '../lib/cli/main.mjs';
import { REMOTE_ERROR_CODES } from '../lib/store/remote.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LIB = join(ROOT, 'core/lib');

/** @param {string} dir @returns {string[]} */
const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.mjs')
        ? [join(dir, e.name)]
        : [],
  );

/** A code is one lowercase word (hyphens or underscores allowed); a message has spaces, a label a capital. */
const WORD = /^[a-z][a-z0-9_-]*$/;

/**
 * Every error code written as a literal in the library: `error: 'code'` (and each branch of a
 * conditional), the error classes and helpers that take a code first, and the lease codes the
 * command prefixes with `lease-`.
 * @returns {Map<string, string[]>} code to the files that write it
 */
function codesInSource() {
  /** @type {Map<string, string[]>} */
  const found = new Map();
  /** @param {string} code @param {string} file */
  const add = (code, file) => found.set(code, [...(found.get(code) ?? []), file]);
  for (const file of sources(LIB)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    for (const m of text.matchAll(/\berror:\s*([^,}\n]+)/g)) {
      for (const lit of m[1].matchAll(/'([^'\n]*)'/g)) if (WORD.test(lit[1])) add(lit[1], rel);
    }
    for (const m of text.matchAll(
      /\bnew (?:Refusal|GateRefusal|SealedError|StoreGitError|StoreRemoteError)\(\s*'([^'\n]*)'/g,
    )) {
      add(m[1], rel);
    }
    for (const m of text.matchAll(/\b(?:fail|refuse)\(\s*'([^'\n]*)'/g)) {
      if (WORD.test(m[1])) add(m[1], rel);
    }
    for (const m of text.matchAll(/\bnew LeaseError\(\s*'([^'\n]*)'/g)) add(`lease-${m[1]}`, rel);
  }
  return found;
}

test('every code in the map is lowercase kebab-case and has a one-line meaning', () => {
  assert.ok(Object.isFrozen(ERROR_CODES));
  for (const [code, meaning] of Object.entries(ERROR_CODES)) {
    assert.match(code, KEBAB_CASE, `${code} is not lowercase kebab-case`);
    assert.ok(
      typeof meaning === 'string' && meaning.trim() !== '' && !meaning.includes('\n'),
      `${code} needs a one-line meaning`,
    );
  }
  assert.equal(isErrorCode('not-permitted'), true);
  assert.equal(isErrorCode('not_permitted'), false);
});

test('every error code written in the library is in the map and kebab-case', () => {
  const found = codesInSource();
  assert.ok(found.size > 80, 'the scan found the codes');
  for (const [code, files] of found) {
    assert.match(code, KEBAB_CASE, `${code} (${files[0]}) is not lowercase kebab-case`);
    assert.ok(isErrorCode(code), `${code} (${files[0]}) is not in core/lib/cli/errors.mjs`);
  }
});

test('every code the store remote throws is in the map', () => {
  for (const code of REMOTE_ERROR_CODES) assert.ok(isErrorCode(code), code);
});

test('the map holds no code the library never writes', () => {
  const written = codesInSource();
  const text = sources(LIB)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  for (const code of Object.keys(ERROR_CODES)) {
    assert.ok(written.has(code) || text.includes(`'${code}'`), `${code} is not used`);
  }
});

test('one meaning, one code: the old synonyms are gone', () => {
  for (const old of ['not_permitted', 'not_allowed', 'refused', 'no_policy', 'dispatch_refused']) {
    assert.equal(isErrorCode(old), false, old);
  }
  const found = codesInSource();
  for (const old of ['not_permitted', 'not_allowed', 'refused'])
    assert.equal(found.has(old), false);
});

/**
 * Run every command with no input, in a directory with no policy: most stop at their first check,
 * and each failure must carry a code from the map.
 * @param {string} cwd
 */
async function failuresIn(cwd) {
  const home = mkdtempSync(join(tmpdir(), 'hitld-err-home-'));
  /** @type {Array<{ command: string, error: unknown }>} */
  const failures = [];
  for (const c of COMMANDS) {
    if (!c.run) continue;
    let out = '';
    await main(c.name.split(' '), {
      out: (t) => (out += t),
      err: () => {},
      cwd,
      env: { HOME: home, XDG_DATA_HOME: home, XDG_CONFIG_HOME: home, PATH: process.env.PATH },
    });
    let json;
    try {
      json = JSON.parse(out);
    } catch {
      continue; // help text or a command that writes no JSON
    }
    if (json && json.ok === false && json.error !== undefined) {
      failures.push({ command: c.name, error: json.error });
    }
  }
  return failures;
}

test('the codes the command table returns with no input are in the map', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'hitld-err-plain-'));
  const repo = mkdtempSync(join(tmpdir(), 'hitld-err-repo-'));
  execFileSync('git', ['init', '-q', repo]);
  const seen = new Set();
  for (const cwd of [plain, repo]) {
    for (const f of await failuresIn(cwd)) {
      assert.equal(typeof f.error, 'string', f.command);
      assert.match(String(f.error), KEBAB_CASE, `${f.command}: ${f.error}`);
      assert.ok(isErrorCode(String(f.error)), `${f.command}: ${f.error} is not in the map`);
      seen.add(f.error);
    }
  }
  assert.ok(seen.has('usage') && seen.has('not-a-repository'), [...seen].join(', '));
});

test('an unknown command and a command not yet built use codes from the map', async () => {
  const run = async (/** @type {string[]} */ argv) => {
    let out = '';
    await main(argv, { out: (t) => (out += t), err: () => {}, cwd: ROOT, env: {} });
    return JSON.parse(out).error;
  };
  assert.equal(await run(['no-such-command']), 'usage');
  const unbuilt = COMMANDS.find((c) => !c.run);
  if (unbuilt) assert.equal(await run(unbuilt.name.split(' ')), 'not-built');
});
