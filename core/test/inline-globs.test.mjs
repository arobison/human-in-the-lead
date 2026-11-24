// The tracker's own folder (tracker.json work_dir) is always an inline path: an item that touches
// only tracker files is tier 0, and a branch's claim and close edits of its item file are not
// "outside its touches", whatever dispatch.inline_globs says (HITLD-285, GitHub issue #156).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { sizeItem } from '../lib/dispatch/sizing.mjs';
import { inlineGlobs } from '../lib/dispatch/item.mjs';
import { evidenceFor } from '../lib/merge/owner.mjs';
import {
  MERGE_SETTINGS,
  commitAll,
  fixtureGit,
  itemFile,
} from '../lib/eval/orchestrator-fixtures.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, makeConsumer, put } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const minimal = { schema_version: 1, project: { id: 'test', key: 'W' } };
/** @param {Record<string, unknown>} [extra] */
const policyOf = (extra = {}) => {
  const { policy, errors } = resolvePolicy({ ...minimal, ...extra });
  if (!policy) throw new Error(JSON.stringify(errors));
  return policy;
};
const BODY = '\n## Done when\n\n`npm test` passes.\n\n## Plan\n\nChange `src/a.js`.\n';
const base = { kind: 'work', state: 'planned', classification: 'public', body: BODY };

test('dispatch.inline_globs: the default names no folder; the tracker work_dir is added instead', () => {
  assert.deepEqual(policyOf().dispatch.inline_globs, []);
  assert.deepEqual(inlineGlobs(policyOf(), 'tracker'), ['tracker/**']);
  assert.deepEqual(inlineGlobs(policyOf(), 'docs/work/'), ['docs/work/**']);
  // Without a work_dir, the tracker's default folder.
  assert.deepEqual(inlineGlobs(policyOf()), ['work/**']);
  // A project's own globs are kept, the tracker folder after them, once.
  const own = policyOf({ dispatch: { inline_globs: ['notes/**', 'tracker/**'] } });
  assert.deepEqual(inlineGlobs(own, 'tracker'), ['notes/**', 'tracker/**']);
});

test('sizing: an item touching only files under work_dir is tier 0, wherever work_dir is', () => {
  const p = policyOf();
  const tracked = { ...base, id: 'W-1', touches: ['tracker/items/W-9.md'] };
  assert.equal(sizeItem(tracked, p, [], { workDir: 'tracker' }).tier, 0);
  // A folder named work that is not the tracker is source like any other.
  const source = { ...base, id: 'W-2', touches: ['work/a.js'] };
  assert.notEqual(sizeItem(source, p, [], { workDir: 'tracker' }).tier, 0);
  // The default layout still sizes a tracker edit tier 0.
  assert.equal(sizeItem({ ...base, id: 'W-3', touches: ['work/items/W-9.md'] }, p).tier, 0);
});

test('evidenceFor: the claim and close edits under work_dir are not outside the touches', () => {
  const root = tempDir('hitld-inline-evidence-');
  fixtureGit(root, 'init', '-q', '-b', 'main');
  fixtureGit(root, 'config', 'user.email', 'f@example.invalid');
  fixtureGit(root, 'config', 'user.name', 'F');
  put(root, { 'src/x.js': 'export const x = 1;\n', 'tracker/items/W-1.md': 'a\n' });
  const parent = commitAll(root, 'base');
  put(root, { 'src/x.js': 'export const x = 2;\n', 'tracker/items/W-1.md': 'b\n' });
  const commit = commitAll(root, 'work');
  const ev = evidenceFor({
    repoRoot: root,
    tested: {
      item: 'W-1',
      branch: 'b',
      commit,
      parent,
      changed: ['src/x.js', 'tracker/items/W-1.md'],
    },
    branchSha: commit,
    touches: ['src/**'],
    settings: { ...MERGE_SETTINGS, generated: [...MERGE_SETTINGS.generated], workDir: 'tracker' },
    policy: /** @type {any} */ (policyOf()),
  });
  assert.deepEqual(ev.outside_touches, []);
  assert.deepEqual(ev.deviations, []);
});

test('dispatch plan: in a project whose work_dir is not work, a tracker-only item runs inline', async () => {
  const c = makeConsumer({
    files: {
      '.human-in-the-lead/tracker.json': JSON.stringify({
        schema_version: 1,
        work_dir: 'tracker',
        optional_keys: ['touches', 'serial', 'tier_override', 'estimate_tokens'],
      }),
      'tracker/items/W-7-tidy-the-tracker.md': itemFile({
        id: 'W-7',
        title: 'Tidy the tracker',
        kind: 'work',
        state: 'planned',
        touches: ['tracker/items/W-8.md'],
      }),
      'tracker/items/W-8-some-code.md': itemFile({
        id: 'W-8',
        title: 'Some code',
        kind: 'work',
        state: 'planned',
        touches: ['src/calc.js'],
      }),
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const plan = await c.hitld(['dispatch', 'plan']);
  assert.equal(plan.exit, 0, JSON.stringify(plan.result));
  assert.deepEqual(plan.result.inline, ['W-7'], JSON.stringify(plan.result));
  assert.ok(!plan.result.start.some((/** @type {any} */ s) => s.item === 'W-7'));
});
