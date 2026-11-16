// The executor contract's claim and close steps, followed literally against the files backend:
// what the contract tells an executor to write is exactly what the tracker reads (HITLD-82). An
// executor who edits the item file by hand, as the contract words it, makes a claim the tracker
// sees and a close the check accepts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { git, isolatedEnv, makeRepo, policyFor } from './tracker-fixture.mjs';

/** No person file, private store or store address of this machine is read. */
const HOME = isolatedEnv();

const TEMPLATE = readFileSync(
  join(fileURLToPath(new URL('../..', import.meta.url)), 'templates', 'AGENTS.contract.md'),
  'utf8',
);

/**
 * The `key: value` snippets a numbered step of the contract tells the executor to write.
 * @param {number} n the step number
 * @returns {[string, string][]}
 */
function writes(n) {
  const step = TEMPLATE.split('\n').find((l) => l.startsWith(`${n}. `));
  assert.ok(step, `the contract has a step ${n}`);
  return [...step.matchAll(/`([a-z_]+): ([^`]+)`/g)].map((m) => [m[1], m[2]]);
}

/**
 * Set front-matter keys by hand, as an executor following the contract would: replace the key's
 * line, or add it at the end of the front matter.
 * @param {string} text @param {[string, string][]} pairs
 */
function edit(text, pairs) {
  const end = text.indexOf('\n---', 4);
  let fm = text.slice(0, end);
  for (const [key, value] of pairs) {
    const line = new RegExp(`^${key}:.*$`, 'm');
    fm = line.test(fm) ? fm.replace(line, `${key}: ${value}`) : `${fm}\n${key}: ${value}`;
  }
  return fm + text.slice(end);
}

test("the contract's claim and close steps, written by hand, are what the files backend reads", () => {
  const claim = writes(1);
  const close = writes(2);
  assert.deepEqual(
    claim.map(([k]) => k),
    ['state', 'claimed_by'],
    'step 1 names the state and the claim key',
  );
  assert.deepEqual(close, [['state', 'done']], 'step 2 names the done state');

  const root = makeRepo();
  const open = () => openTracker({ repoRoot: root, policy: policyFor(), env: { ...HOME } });
  const path = 'work/items/W-4-second-step.md';
  const file = join(root, path);
  git(root, 'checkout', '-q', '-b', 'exec/w-4', 'main');

  // Step 1: the branch's first commit changes only the item file.
  const pairs = claim.map(
    ([k, v]) => /** @type {[string, string]} */ ([k, v.replace(/<[^>]+>/, 'D-4')]),
  );
  writeFileSync(file, edit(readFileSync(file, 'utf8'), pairs));
  git(root, 'commit', '-q', '-am', 'claim: W-4', '-m', 'Work-Item: W-4\nDispatch: D-4');
  assert.deepEqual(open().check().problems, [], 'the claim passes the check on the branch');
  assert.equal(open().get('W-4').state, 'in-progress');
  assert.equal(open().get('W-4').claimed_by, 'D-4');
  git(root, 'checkout', '-q', 'main');
  assert.deepEqual(
    open()
      .claims()
      .map((c) => [c.id, c.claims[0].claimant, c.claims[0].branch]),
    [['W-4', 'D-4', 'exec/w-4']],
    'the claim is read from the branch',
  );
  assert.deepEqual(open().check({ inflight: ['D-4'] }).problems, []);

  // Step 2: close in the same change, then merge.
  git(root, 'checkout', '-q', 'exec/w-4');
  writeFileSync(file, edit(readFileSync(file, 'utf8'), close));
  git(root, 'commit', '-q', '-am', 'close: W-4', '-m', 'Work-Item: W-4\nDispatch: D-4');
  assert.deepEqual(open().check().problems, []);
  git(root, 'checkout', '-q', 'main');
  git(root, 'merge', '-q', '--no-ff', '--no-edit', 'exec/w-4');
  const t = open();
  assert.deepEqual(t.check().problems, [], 'main goes from planned straight to done');
  assert.equal(t.get('W-4').state, 'done');
  assert.deepEqual(t.claims(), []);
});

test('hitld install rewrites a contract block from before HITLD-82 (state: In progress, status, runs)', async () => {
  const { installBlock, renderBlock } = await import('../lib/contract/block.mjs');
  const { readFileSync: rd, writeFileSync: wr } = await import('node:fs');
  const { join: jn } = await import('node:path');
  const { tempDir } = await import('./helpers/tmp.mjs');
  const dir = tempDir('hitld-contract-old-');
  const old = renderBlock()
    .replace('`state: in-progress`', '`state: In progress`')
    .replace('result: done | partial | blocked', 'status: done | partial | blocked')
    .replace('bench_runs: <run ID>', 'runs: <run ID>');
  wr(jn(dir, 'AGENTS.md'), `# Agents\n\nOwn text.\n\n${old}`);
  assert.equal(installBlock(dir).action, 'updated');
  const text = rd(jn(dir, 'AGENTS.md'), 'utf8');
  assert.ok(text.startsWith('# Agents\n\nOwn text.\n'), 'text outside the markers is kept');
  assert.ok(text.includes('`state: in-progress`') && text.includes('\nresult: done'));
  assert.equal(text.includes('status:'), false);
});
