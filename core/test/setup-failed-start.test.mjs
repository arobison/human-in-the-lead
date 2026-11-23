// HITLD-934: on the guide's own env.worktree_setup ["npm ci"] in a project with no lockfile, the
// first `dispatch start` refused with setup-failed and no cause; the cause showed only in
// `hitld env status`, which nothing pointed to. Each retry then left one more worktree and a -2
// branch. A failed setup now names the command and its output, points to `hitld env status`, and
// removes the worktree and the branch it made, so a retry starts clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { STATUS_INPUT, git, item, makeConsumer } from './orchestrator-fixture.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';

// What `npm ci` prints without a lockfile, without needing npm or the network.
const FAILING = "echo 'resolving'; echo 'npm error code EUSAGE' >&2; exit 1";

function consumer() {
  const c = makeConsumer({
    policy: { env: { worktree_setup: [FAILING] } },
    files: {
      'work/items/W-4-redesign.md': item({
        id: 'W-4',
        title: 'Redesign',
        kind: 'work',
        state: 'planned',
        tier_override: '3',
        touches: ['src/other.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  return c;
}

/** The worktrees git lists, beside the primary checkout. @param {string} root */
const extraWorktrees = (root) =>
  git(root, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .slice(1);

test('a failed setup names the failing command and its output, and points to hitld env status', async () => {
  const c = consumer();
  await c.hitld(['run', 'start']);
  const start = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'interactive']);
  assert.notEqual(start.exit, 0);
  assert.equal(start.result.error, 'setup-failed');
  const message = String(start.result.message);
  assert.ok(message.includes(FAILING), `names the command: ${message}`);
  assert.match(message, /exit 1|exited 1/);
  assert.match(message, /npm error code EUSAGE/, 'carries the tail of its output');
  assert.match(message, /hitld env status/, 'points to hitld env status');
  // And env status holds the record it points to.
  const status = await c.hitld(['env', 'status']);
  const lease = status.result.worktrees.find(
    (/** @type {{ holder: string }} */ w) => w.holder === start.result.dispatch,
  );
  assert.ok(lease, JSON.stringify(status.result.worktrees));
  assert.equal(lease.state, 'setup-failed');
  assert.match(lease.setup.steps.at(-1).output_tail, /EUSAGE/);
});

test('a failed setup removes the worktree and the branch it made, so a retry starts clean', async () => {
  const c = consumer();
  await c.hitld(['run', 'start']);
  const first = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'interactive']);
  assert.equal(first.result.error, 'setup-failed');
  assert.deepEqual(extraWorktrees(c.root), [], 'no worktree is left');
  assert.equal(git(c.root, 'branch', '--list', 'hitld/*'), '', 'no branch is left');

  const again = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'interactive']);
  assert.equal(again.result.error, 'setup-failed', JSON.stringify(again.result));
  assert.doesNotMatch(String(again.result.message), /already exists/);
  assert.deepEqual(extraWorktrees(c.root), [], 'still no worktree after the retry');
  assert.equal(git(c.root, 'branch', '--list', 'hitld/*'), '', 'and no -2 branch');
});

test('a setup that passes still keeps its worktree and branch', async () => {
  const c = makeConsumer({
    policy: { env: { worktree_setup: ['echo ok'] } },
    files: {
      'work/items/W-4-redesign.md': item({
        id: 'W-4',
        title: 'Redesign',
        kind: 'work',
        state: 'planned',
        tier_override: '3',
        touches: ['src/other.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  await c.hitld(['run', 'start']);
  const start = await c.hitld(['dispatch', 'start', 'W-4', '--mode', 'interactive']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  assert.ok(existsSync(start.result.worktree));
  assert.doesNotMatch(start.result.branch, /-2$/);
});
