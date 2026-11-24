// Driving one item by hand, without Claude Code (HITLD-937): the guide's "by hand" section names
// the commands in order, and that order works in a fresh project with no harness session, no
// usage reading and the first-run setup not done.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';

const GUIDE = fileURLToPath(new URL('../../docs/guide/new-project.md', import.meta.url));

/** The guide's declared limit: a weekly token budget the ledger reads. */
const WEEKLY_TOKENS = {
  id: 'weekly-tokens',
  unit: 'tokens',
  window: 'weekly',
  limit: 20000000,
  source: 'estimated',
  hard: false,
};

/** The guide's by-hand section, from its heading to the next heading of the same level. */
function byHandSection() {
  const text = readFileSync(GUIDE, 'utf8');
  const start = text.indexOf('\n## Drive one item by hand');
  assert.ok(start >= 0, 'the guide has a "Drive one item by hand" section');
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

test('the guide names the by-hand commands in the order that runs them', () => {
  const section = byHandSection();
  const order = [
    'hitld run start',
    'hitld dispatch start <ID> --by-hand',
    'hitld dispatch handle',
    'hitld work claim <ID>',
    'hitld work close <ID> --report-file',
    'hitld dispatch complete',
    'hitld merge',
    'hitld merge --all',
  ];
  let at = 0;
  for (const words of order) {
    const found = section.indexOf(words, at);
    assert.ok(found >= 0, `"${words}" appears after the command before it`);
    at = found + words.length;
  }
});

test('the by-hand order works with no harness session, no usage reading and setup not done', async () => {
  const c = makeConsumer({
    setup: false,
    policy: { merge: { mode: 'owner', full_suite: ['node --test "test/*.test.js"'] } },
  });
  // No Claude Code: no harness session ID, and HITLD_SESSION is not set.
  const bare = { env: { HITLD_SESSION: undefined } };
  const run = (/** @type {string[]} */ argv) => c.hitld(argv, bare);

  // No status line either: the quota gate has no reading until a limit the ledger can read is
  // declared, and --by-hand does not pass the gate.
  const limit = await run([
    'config',
    'write',
    'person',
    '--merge',
    '--data',
    JSON.stringify({ schema_version: 1, quota: { limits: [WEEKLY_TOKENS] } }),
  ]);
  assert.equal(limit.exit, 0, JSON.stringify(limit.result));

  const started = await run(['run', 'start']);
  assert.equal(started.exit, 0, JSON.stringify(started.result));
  assert.equal(
    started.result.identity.source,
    'new',
    'run start makes a session for this checkout',
  );

  const plan = await run(['dispatch', 'plan']);
  assert.equal(plan.exit, 0, JSON.stringify(plan.result));

  const start = await run(['dispatch', 'start', 'W-1', '--by-hand']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  const { dispatch, branch } = start.result;
  assert.equal(start.result.worktree ?? null, null, 'tier 1: no worktree, the person switches');

  const handle = await run([
    'dispatch',
    'handle',
    '--dispatch',
    dispatch,
    '--harness-ref',
    'by-hand',
  ]);
  assert.equal(handle.exit, 0, JSON.stringify(handle.result));

  // The person does the work on the branch: claim, change, close with the report.
  git(c.root, 'switch', '-q', '-c', branch);
  const claim = await run(['work', 'claim', 'W-1', '--dispatch', dispatch, '--branch', branch]);
  assert.equal(claim.exit, 0, JSON.stringify(claim.result));
  put(c.root, {
    'src/calc.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
  });
  git(c.root, 'commit', '-q', '-am', 'Add sub', '-m', `Work-Item: W-1\nDispatch: ${dispatch}`);
  const sha = git(c.root, 'rev-parse', 'HEAD');
  const note = join(c.base, 'report.txt');
  writeFileSync(note, report({ item: 'W-1', sha, branch }));
  const close = await run(['work', 'close', 'W-1', '--report-file', note]);
  assert.equal(close.exit, 0, JSON.stringify(close.result));
  git(c.root, 'switch', '-q', 'main');

  const done = await run([
    'dispatch',
    'complete',
    '--dispatch',
    dispatch,
    '--report-file',
    note,
    '--tokens',
    '0',
  ]);
  assert.equal(done.exit, 0, JSON.stringify(done.result));
  assert.equal(done.result.queued_to_merge, branch);

  const presented = await run(['merge']);
  assert.equal(presented.exit, 0, JSON.stringify(presented.result));
  assert.deepEqual(
    presented.result.presented.map((/** @type {any} */ p) => p.item),
    ['W-1'],
  );

  const merged = await run(['merge', '--all']);
  assert.equal(merged.exit, 0, JSON.stringify(merged.result));
  assert.deepEqual(merged.result.merged, ['W-1']);
  assert.match(readFileSync(join(c.root, 'work/items/W-1-add-numbers.md'), 'utf8'), /state: done/);
});
