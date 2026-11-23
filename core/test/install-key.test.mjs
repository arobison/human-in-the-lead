// hitld install and the project key (HITLD-933): a --key that does not match the key pattern is
// refused before anything is written, a --key that differs from the existing policy's is refused
// with a message saying so, and the contract example is rendered with the project's real key, so
// fixing a policy by hand does not make the block look edited by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../lib/install/install.mjs';
import { installBlock } from '../lib/contract/block.mjs';
import { checkContract } from '../lib/contract/check.mjs';
import { POLICY_PATH } from '../lib/policy/policy.mjs';
import { VERSION } from '../lib/version.mjs';
import { tempDir } from './helpers/tmp.mjs';

const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));

/** A fresh git repository with no hitld files in it. */
function repo() {
  const root = tempDir('hitld-install-key-');
  execFileSync('git', ['init', '-q', root]);
  return root;
}

/** @param {string} root @param {Record<string, unknown>} input */
const run = (root, input) =>
  install({ marketplace: CHECKOUT, ...input }, { cwd: root, env: { PATH: process.env.PATH } });

/** @param {string} root */
const policyKey = (root) => JSON.parse(readFileSync(join(root, POLICY_PATH), 'utf8')).project.key;

test('a lower-case --key is refused before anything is written', () => {
  const root = repo();
  const hooksBefore = readdirSync(join(root, '.git', 'hooks')).sort();
  for (const key of ['sam', 'P', 'TOOLONGKEY1', '1AB']) {
    const r = run(root, { key });
    assert.equal(r.ok, false, `${key}: ${JSON.stringify(r)}`);
    assert.equal(r.error, 'usage');
    assert.match(String(r.message), new RegExp(`--key ${key}`));
    assert.match(String(r.message), /\[A-Z\]\[A-Z0-9\]\{0,9\}/, 'the message names the pattern');
  }
  assert.equal(existsSync(join(root, POLICY_PATH)), false, 'no policy.json');
  assert.equal(existsSync(join(root, 'AGENTS.md')), false, 'no AGENTS.md');
  assert.equal(existsSync(join(root, '.claude')), false, 'no settings');
  assert.deepEqual(readdirSync(join(root, '.git', 'hooks')).sort(), hooksBefore, 'no hooks');
});

test('a --key that differs from the existing policy is refused, naming both; the same key is kept', () => {
  const root = repo();
  const first = run(root, { key: 'SAM' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(policyKey(root), 'SAM');
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /^item: SAM-214$/m, 'the example uses the real key');

  const other = run(root, { key: 'APP' });
  assert.equal(other.ok, false, JSON.stringify(other));
  assert.equal(other.error, 'usage');
  assert.match(String(other.message), /differs from the key/);
  assert.match(String(other.message), /APP/);
  assert.match(String(other.message), /SAM/);
  assert.equal(policyKey(root), 'SAM', 'the policy is unchanged');
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), agents, 'AGENTS.md is unchanged');

  // An invalid --key is refused as invalid even when a policy exists.
  const bad = run(root, { key: 'sam' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'usage');

  const same = run(root, { key: 'SAM' });
  assert.equal(same.ok, true, JSON.stringify(same));
  assert.equal(/** @type {any} */ (same.done).policy, 'kept');
  const none = run(root, {});
  assert.equal(none.ok, true, JSON.stringify(none));
  assert.equal(checkContract(root, VERSION, 'SAM').block, 'current');
});

test('a policy fixed by hand does not make a block rendered with the fallback key look edited by hand', () => {
  // The state an install before HITLD-933 left: policy key "sam", which the pattern refuses, and
  // a block whose example fell back to the default key. The owner then fixes the key by hand.
  const root = repo();
  const first = run(root, { key: 'SAM' });
  assert.equal(first.ok, true, JSON.stringify(first));
  installBlock(root, VERSION, 'sam');
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /^item: W-214$/m);

  const check = checkContract(root, VERSION, 'SAM');
  assert.equal(check.ok, false);
  assert.notEqual(check.block, 'modified');
  assert.doesNotMatch(check.errors.join('\n'), /edited by hand/);
  assert.match(check.errors.join('\n'), /W/);
  assert.match(check.errors.join('\n'), /SAM/);
  assert.match(check.errors.join('\n'), /hitld install/);

  // install, with or without the key, renders the example with the real key.
  const again = run(root, { key: 'SAM' });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(/** @type {any} */ (again.done).agents_md, 'updated');
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /^item: SAM-214$/m);
  assert.equal(checkContract(root, VERSION, 'SAM').block, 'current');
});

test('a block edited by hand is still reported as edited by hand', () => {
  const root = repo();
  mkdirSync(join(root, '.human-in-the-lead'), { recursive: true });
  assert.equal(run(root, { key: 'SAM' }).ok, true);
  const path = join(root, 'AGENTS.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^item: SAM-214$/m, 'item: SAM-999'));
  const check = checkContract(root, VERSION, 'SAM');
  assert.equal(check.block, 'modified');
  assert.match(check.errors.join('\n'), /edited by hand/);
});
