// An executor's claim and close commits carry the Work-Item, Dispatch and Agent-Role trailers
// (HITLD-1037), so a pull request opened from them passes the dco check with no amend.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCommits, readCommits } from '../lib/dco/check.mjs';
import { item, makeConsumer } from './orchestrator-fixture.mjs';

const DISPATCH = 'D-01M88NWF6AKKD2D4';
const EXECUTOR = { HITLD_DISPATCH: DISPATCH, HITLD_ROLE: 'executor' };

/** @param {string} root @param {...string} args */
const git = (root, ...args) =>
  spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout.trim();

/** A consumer repository with W-9 planned, on the executor's branch. */
function setup() {
  const c = makeConsumer({
    files: {
      'work/items/W-9-change.md': item({
        id: 'W-9',
        title: 'change W-9',
        kind: 'work',
        state: 'planned',
      }),
    },
  });
  git(c.root, 'checkout', '-q', '-b', 'hitld/W-9-change');
  return c;
}

/** The trailer lines of a commit's message. @param {string} root @param {string} rev */
const trailersOf = (root, rev) =>
  git(root, 'log', '-1', '--format=%(trailers:only,unfold)', rev).split('\n').filter(Boolean);

test("work claim under an executor's environment writes Work-Item, Dispatch and Agent-Role", async () => {
  const c = setup();
  const claim = await c.hitld(['work', 'claim', 'W-9', '--dispatch', DISPATCH], { env: EXECUTOR });
  assert.equal(claim.exit, 0, JSON.stringify(claim.result));
  assert.deepEqual(trailersOf(c.root, 'HEAD'), [
    'Work-Item: W-9',
    `Dispatch: ${DISPATCH}`,
    'Agent-Role: executor',
  ]);
});

test("work close under an executor's environment writes them too, after the report", async () => {
  const c = setup();
  const base = git(c.root, 'rev-parse', 'HEAD');
  assert.equal(
    (await c.hitld(['work', 'claim', 'W-9', '--dispatch', DISPATCH], { env: EXECUTOR })).exit,
    0,
  );
  const report = join(c.base, 'report.txt');
  writeFileSync(report, 'item: W-9\nresult: done\n');
  const close = await c.hitld(['work', 'close', 'W-9', '--report-file', report], { env: EXECUTOR });
  assert.equal(close.exit, 0, JSON.stringify(close.result));
  assert.deepEqual(trailersOf(c.root, 'HEAD'), [
    'Work-Item: W-9',
    `Dispatch: ${DISPATCH}`,
    'Agent-Role: executor',
  ]);
  assert.match(git(c.root, 'log', '-1', '--format=%B'), /^close: W-9\n\nitem: W-9\nresult: done\n/);
  // The pull request's commits, the claim and the close, pass the dco check without a sign-off.
  const commits = readCommits(c.root, base, 'HEAD');
  assert.equal(commits.length, 2);
  assert.deepEqual(checkCommits(commits, 'pr').findings, []);
});

test('with no role in the environment, or one that is not a role name, no Agent-Role is written', async () => {
  for (const env of [{ HITLD_ROLE: '' }, { HITLD_ROLE: 'Executor\nSigned-off-by: x <x@x>' }]) {
    const c = setup();
    const claim = await c.hitld(['work', 'claim', 'W-9', '--dispatch', DISPATCH], { env });
    assert.equal(claim.exit, 0, JSON.stringify(claim.result));
    assert.deepEqual(trailersOf(c.root, 'HEAD'), ['Work-Item: W-9', `Dispatch: ${DISPATCH}`]);
  }
});
