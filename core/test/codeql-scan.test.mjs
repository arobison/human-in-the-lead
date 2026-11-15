// This repository's own merge scanner (HITLD-73): the policy entry and the wrapper's refusals.
// The CodeQL CLI itself is not run here; the gate's behaviour is tested with the fixture scanner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const wrapper = fileURLToPath(new URL('../../scripts/codeql-scan.mjs', import.meta.url));

test('policy: this repository declares CodeQL, run from the primary checkout, writing SARIF', () => {
  const policy = JSON.parse(readFileSync(`${repo}.human-in-the-lead/policy.json`, 'utf8'));
  const [scanner, ...rest] = policy.merge.scanners;
  assert.equal(rest.length, 0);
  assert.equal(scanner.name, 'codeql');
  assert.equal(scanner.format, 'sarif');
  assert.match(
    scanner.command,
    /^node "\$\{HITLD_PRIMARY_ROOT:\?[^}]*\}\/scripts\/codeql-scan\.mjs"$/,
  );
});

/** @param {Record<string, string>} env */
const run = (env) => {
  const { HITLD_CODEQL: _c, HITLD_SARIF: _s, NODE_TEST_CONTEXT: _t, ...rest } = process.env;
  return spawnSync(process.execPath, [wrapper], { env: { ...rest, ...env }, encoding: 'utf8' });
};

test('wrapper: refuses without HITLD_CODEQL and says how to install the pinned version', () => {
  const r = run({ HITLD_SARIF: '/nonexistent/out.sarif' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /HITLD_CODEQL is not set/);
  assert.match(r.stderr, /codeql-bundle-v2\.27\.4\/codeql-bundle-linux64\.tar\.gz/);
  assert.match(r.stderr, /89ed56c8ec6bfccef6a0d2e7fe86da0469ca24b4db08b88016ec134b942c17a4/);
});

test('wrapper: refuses a CodeQL that is not the pinned version', () => {
  // A stand-in executable that reports another version.
  const r = run({
    HITLD_SARIF: '/nonexistent/out.sarif',
    HITLD_CODEQL: '/bin/true',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /this repository pins 2\.27\.4/);
});
