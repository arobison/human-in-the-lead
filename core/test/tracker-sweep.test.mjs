// The stale-item sweep (HITLD-132, design part 13.3): `hitld work sweep` reads the tracker, its
// branches and the ledger, and lists what drifted. It is deterministic and changes nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { findCommand } from '../lib/cli/table.mjs';
import { buildSweepConsumer } from '../lib/eval/orchestrator-fixtures.mjs';
import { SWEEP_KINDS } from '../lib/tracker/files/sweep.mjs';
import { tempDir } from './helpers/tmp.mjs';

/** A fresh fixture and a runner for the command line in it. */
function fixture() {
  const dir = tempDir('hitld-sweep-');
  const data = join(dir, 'data');
  const made = buildSweepConsumer(join(dir, 'consumer'), data);
  const env = { XDG_DATA_HOME: data, XDG_CONFIG_HOME: join(dir, 'config'), PATH: process.env.PATH };
  /** @param {string[]} argv @param {NodeJS.ProcessEnv} [extra] */
  const hitld = async (argv, extra = {}) => {
    let out = '';
    const code = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: made.root,
      env: { ...env, ...extra },
    });
    return { code, result: /** @type {Record<string, any>} */ (JSON.parse(out)) };
  };
  return { ...made, data, hitld };
}

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('the sweep lists each finding kind, in order, and nothing beside them', async () => {
  const f = fixture();
  const before = git(f.root, 'rev-parse', 'HEAD');
  const { code, result } = await f.hitld(['work', 'sweep', '--now', f.now]);
  assert.equal(code, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.findings.map((/** @type {any} */ x) => [x.kind, x.item]),
    [
      ['orphaned-claim', 'W-1'],
      ['proposed-too-old', 'W-3'],
      ['blockers-resolved', 'W-6'],
      ['merged-but-open', 'W-8'],
      ['merged-but-open', 'W-10'],
      ['release-needs-overlap', 'W-11'],
      ['missing-release-note', 'W-14'],
    ],
  );
  assert.deepEqual(result.checked, [...SWEEP_KINDS]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(Object.keys(result.counts), [...SWEEP_KINDS]);
  assert.equal(result.counts['merged-but-open'], 2);
  assert.match(result.summary, /^7 finding\(s\): 1 orphaned-claim, /);

  const by = (/** @type {string} */ id) =>
    result.findings.find((/** @type {any} */ x) => x.item === id);
  assert.equal(by('W-1').dispatch, 'D-1');
  assert.equal(by('W-1').branch, 'hitld/W-1-claim');
  assert.equal(by('W-3').age_days, 76);
  assert.deepEqual(by('W-6').needs, ['W-5']);
  assert.equal(by('W-8').evidence.length, 1);
  assert.match(by('W-10').evidence[0], /^ledger E-\d+$/);
  assert.equal(by('W-11').other, 'W-13');
  assert.deepEqual(by('W-11').shared, ['W-12']);
  assert.deepEqual(by('W-14').files, ['schemas/thing.schema.json']);

  // It changes nothing, and asking twice gives the same answer.
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), before);
  assert.deepEqual((await f.hitld(['work', 'sweep', '--now', f.now])).result, result);
});

test('a kind the sweep cannot check is skipped with the reason, never reported clean', async () => {
  const f = fixture();
  // No dispatch in the ledger: claims cannot be matched against it.
  writeFileSync(join(f.data, 'human-in-the-lead', f.project, 'ledger.jsonl'), '');
  // proposed_max_age 0 is off; release_note not turned on.
  const policyPath = join(f.root, '.human-in-the-lead', 'policy.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.sweep = { proposed_max_age: 0 };
  writeFileSync(policyPath, JSON.stringify(policy));
  writeFileSync(
    join(f.root, '.human-in-the-lead', 'tracker.json'),
    JSON.stringify({ schema_version: 1 }),
  );
  // An item with a release_note key no longer validates without the optional key.
  const w15 = join(f.root, 'work', 'items', 'W-15-changed-a-schema-with-a-note.md');
  writeFileSync(w15, readFileSync(w15, 'utf8').replace(/^release_note: .*\n/m, ''));
  const { result } = await f.hitld(['work', 'sweep', '--now', f.now]);
  assert.deepEqual(
    result.skipped.map((/** @type {any} */ s) => s.kind),
    ['orphaned-claim', 'proposed-too-old', 'missing-release-note'],
  );
  assert.match(result.skipped[0].why, /ledger records no dispatch/);
  assert.match(result.skipped[1].why, /proposed_max_age is 0/);
  assert.match(result.skipped[2].why, /release_note is not turned on/);
  assert.deepEqual(result.checked, [
    'blockers-resolved',
    'merged-but-open',
    'release-needs-overlap',
  ]);
  assert.equal(result.counts['orphaned-claim'], 0);
});

test('the age threshold is the policy’s, and a bad --now is a usage error', async () => {
  const f = fixture();
  const early = await f.hitld(['work', 'sweep', '--now', '2026-10-01T00:00:00Z']);
  assert.equal(early.result.counts['proposed-too-old'], 0);
  const bad = await f.hitld(['work', 'sweep', '--now', 'soon']);
  assert.notEqual(bad.code, 0);
  assert.equal(bad.result.error, 'usage');
});

test('an executor may run the sweep: it only reads', async () => {
  const f = fixture();
  const { code, result } = await f.hitld(['work', 'sweep', '--now', f.now], {
    HITLD_ROLE: 'executor',
    HITLD_DISPATCH: 'D-9',
  });
  assert.equal(code, 0);
  assert.equal(result.findings.length, 7);
});

test('work sweep is in the command table, built, with its output declared', () => {
  const found = findCommand(['work', 'sweep']);
  assert.ok(found?.command.run);
  assert.deepEqual(found.command.output, [
    'ok',
    'count',
    'counts',
    'findings',
    'checked',
    'skipped',
    'summary',
  ]);
});
