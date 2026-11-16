import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { sizeItem } from '../lib/dispatch/sizing.mjs';
import { planDispatch } from '../lib/dispatch/plan.mjs';
import { renderBrief } from '../lib/dispatch/brief.mjs';
import { deriveTouches, overlapsInFlight, touchesOf } from '../lib/dispatch/touches.mjs';
import { FAKE_PROFILES } from '../harness/fake/fake.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, git, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';

const policy = () => {
  const { policy: p, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 't', key: 'W' },
  });
  if (!p) throw new Error(JSON.stringify(errors));
  return p;
};
const BODY = '\n## Done when\n\n`npm test` passes.\n\n## Plan\n\nChange `src/a.js`.\n';
const always = () => ({ mode: 'normal', allow: true, reason: 'ok' });

const FILES = [
  'src/a.js',
  'src/cache/lru.js',
  'src/cache/index.js',
  'lib/util.js',
  'test/util.js',
  'docs/guide.md',
  'work/items/W-1-x.md',
];

test('derived touches: the paths and modules the text names that the repository has', () => {
  const it = {
    id: 'W-5',
    title: 'Speed up the cache',
    body: [
      '## Why',
      '',
      'The LRU in `src/cache` is slow; `lru.js` evicts too late. See docs/guide.md#cache.',
      'Not `src/gone.js`, and not ../outside/x.js. util.js names two files.',
      'Close work/items/W-1-x.md as usual.',
    ].join('\n'),
  };
  assert.deepEqual(deriveTouches(it, FILES, { inline: ['work/**'] }), [
    'docs/guide.md',
    'lib/util.js',
    'src/cache/**',
    'src/cache/lru.js',
    'test/util.js',
  ]);
  assert.deepEqual(deriveTouches({ id: 'W-6', title: 'Nothing', body: 'No paths.' }, FILES), []);
  // The item's own touches always win; recorded derived ones come next.
  assert.deepEqual(touchesOf({ ...it, touches: ['src/a.js'] }, { files: FILES }), {
    touches: ['src/a.js'],
    source: 'item',
  });
  assert.deepEqual(touchesOf(it, { files: FILES, recorded: ['lib/**'] }), {
    touches: ['lib/**'],
    source: 'derived',
  });
  assert.equal(touchesOf({ id: 'W-6', body: 'none' }, { files: FILES }).source, 'none');
});

test('overlap: an overlapping pair is named with its paths, a non-overlapping one is not', () => {
  const running = [
    { dispatch: 'D-1', item: 'W-1', touches: ['src/cache/**', 'docs/guide.md'] },
    { dispatch: 'D-2', item: 'W-2', touches: ['lib/util.js'] },
  ];
  assert.deepEqual(overlapsInFlight(['src/cache/lru.js', 'src/a.js'], running), [
    { dispatch: 'D-1', item: 'W-1', paths: ['src/cache/**'] },
  ]);
  assert.deepEqual(overlapsInFlight(['test/**'], running), []);

  // The overlap rule uses derived touches when the item has none of its own.
  const p = policy();
  const derivedItem = {
    id: 'W-7',
    kind: 'work',
    state: 'planned',
    classification: 'public',
    body: BODY + '\nAll of it is in `lib/util.js`.\n',
  };
  const sizes = new Map([['W-7', sizeItem(derivedItem, p)]]);
  const r = planDispatch({
    queue: [derivedItem],
    sizes,
    running: [{ dispatch: 'D-2', item: 'W-2', serial_resources: [], touches: ['lib/util.js'] }],
    cap: 3,
    capabilities: FAKE_PROFILES.full,
    gate: always,
    touches: (i) => touchesOf(i, { files: FILES }),
  });
  assert.deepEqual(r.held, [
    { item: 'W-7', reason: 'overlap', why: '50% of its touches overlap running work' },
  ]);

  const it = { ...derivedItem, path: 'work/items/W-7-x.md' };
  const brief = renderBrief({
    item: it,
    sizing: sizeItem(it, p),
    dispatch: 'D-3',
    branch: 'hitld/W-7-x',
    policy: p,
    isolation: 'worktree',
    touches: { touches: ['lib/util.js', 'src/a.js'], source: 'derived' },
    overlaps: [{ dispatch: 'D-2', item: 'W-2', paths: ['lib/util.js'] }],
    merged: [{ commit: 'abcdef1234', items: ['W-1'], subject: 's', paths: ['src/a.js'] }],
  });
  assert.match(brief, /Touches \(derived from the item text\): lib\/util.js, src\/a.js\./);
  assert.match(brief, /In flight on the same paths: D-2 \(W-2\) touches lib\/util.js\./);
  assert.match(
    brief,
    /Merged since this item was planned, on the same paths: abcdef1 \(W-1\) changed src\/a.js\./,
  );
  const plain = renderBrief({
    item: { ...it, touches: ['test/**'] },
    sizing: sizeItem(it, p),
    dispatch: 'D-4',
    branch: 'hitld/W-7-x',
    policy: p,
    isolation: 'worktree',
  });
  assert.match(plain, /Touches: test\/\*\*\./);
  assert.doesNotMatch(plain, /In flight on the same paths|Merged since/);
});

/**
 * A consumer with two more items: W-4 overlaps W-1 a little, W-5 has no touches and names its path
 * in its text. W-2 is only proposed, so the three others fit the cap.
 */
function consumer() {
  const c = makeConsumer({
    policy: { merge: { mode: 'queue', full_suite: [], public_globs: ['src/calc.js'] } },
    files: {
      '.human-in-the-lead/tracker.json': JSON.stringify({
        schema_version: 1,
        optional_keys: ['touches', 'serial', 'tier_override', 'estimate_tokens', 'release_note'],
      }),
      'src/a.js': 'export const a = 1;\n',
      'src/b.js': 'export const b = 1;\n',
      'src/named.js': 'export const named = 1;\n',
      'work/items/W-2-another-thing.md': item({
        id: 'W-2',
        title: 'Another thing',
        kind: 'work',
        state: 'proposed',
        touches: ['src/other.js'],
      }),
      'work/items/W-4-wide.md': item({
        id: 'W-4',
        title: 'Wide',
        kind: 'work',
        state: 'planned',
        touches: ['src/calc.js', 'src/a.js', 'src/b.js'],
      }),
      'work/items/W-5-named.md': item(
        { id: 'W-5', title: 'Named', kind: 'work', state: 'planned' },
        '\n## Done when\n\n`npm test` passes.\n\n## Plan\n\nRename the constant in `src/named.js`.\n',
      ),
    },
  });
  return c;
}

test('dispatch: the brief names overlapping work in flight and merges since planning; derived touches are recorded', async () => {
  const c = consumer();
  // A merge on main after the items were planned, on W-4's paths.
  put(c.root, { 'src/a.js': 'export const a = 2;\n' });
  git(c.root, 'commit', '-q', '-am', 'Change a (W-9)', '-m', 'Work-Item: W-9');
  const merged = git(c.root, 'rev-parse', '--short=7', 'HEAD');
  assert.equal(recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env }).recorded, true);
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);

  const plan = await c.hitld(['dispatch', 'plan']);
  const w5 = plan.result.start.find((/** @type {any} */ s) => s.item === 'W-5');
  assert.deepEqual(w5 && [w5.touches, w5.touches_source], [['src/named.js'], 'derived']);

  const one = await c.hitld(['dispatch', 'start', 'W-1']);
  assert.equal(one.exit, 0, JSON.stringify(one.result));
  const four = await c.hitld(['dispatch', 'start', 'W-4']);
  assert.equal(four.exit, 0, JSON.stringify(four.result));
  const brief = readFileSync(four.result.brief_file, 'utf8');
  assert.match(brief, /In flight on the same paths: D-1 \(W-1\) touches src\/calc.js\./);
  assert.match(
    brief,
    new RegExp(
      `Merged since this item was planned, on the same paths: ${merged} \\(W-9\\) changed src/a.js\\.`,
    ),
  );

  const five = await c.hitld(['dispatch', 'start', 'W-5']);
  assert.equal(five.exit, 0, JSON.stringify(five.result));
  const brief5 = readFileSync(five.result.brief_file, 'utf8');
  assert.match(brief5, /Touches \(derived from the item text\): src\/named.js\./);
  assert.doesNotMatch(brief5, /In flight on the same paths|Merged since/);
  const ledger = readFileSync(
    join(c.data, 'human-in-the-lead/orch-fixture/ledger.jsonl'),
    'utf8',
  ).split('\n');
  const dispatched = ledger
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((e) => e.event === 'dispatched' && e.item === 'W-5');
  assert.deepEqual([dispatched.touches, dispatched.touches_source], [['src/named.js'], 'derived']);
});

test('the report check flags a public-interface change whose item has no release_note', async () => {
  const c = consumer();
  assert.equal(recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env }).recorded, true);
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);

  /** @param {string} id @param {string} path @param {Record<string, string>} files @param {string} [note] */
  const work = async (id, path, files, note) => {
    const start = await c.hitld(['dispatch', 'start', id]);
    assert.equal(start.exit, 0, JSON.stringify(start.result));
    const d = start.result.dispatch;
    await c.hitld(['dispatch', 'handle', '--dispatch', d, '--harness-ref', `agent-${id}`]);
    const branch = start.result.branch;
    git(c.root, 'switch', '-q', '-c', branch);
    const text = readFileSync(join(c.root, path), 'utf8').replace('state: planned', 'state: done');
    put(c.root, {
      ...files,
      [path]: note ? text.replace('\n---\n', `\nrelease_note: ${note}\n---\n`) : text,
    });
    git(c.root, 'commit', '-q', '-am', id);
    const sha = git(c.root, 'rev-parse', 'HEAD');
    git(c.root, 'switch', '-q', 'main');
    const file = join(c.base, `${id}.txt`);
    writeFileSync(file, report({ item: id, sha, branch }));
    const done = await c.hitld(['dispatch', 'complete', '--dispatch', d, '--report-file', file]);
    assert.equal(done.exit, 0, JSON.stringify(done.result));
    return done.result;
  };

  const missing = await work('W-1', 'work/items/W-1-add-numbers.md', {
    'src/calc.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
  });
  assert.deepEqual(missing.release_note_missing?.files, ['src/calc.js']);
  assert.match(missing.release_note_missing.next, /has no release_note: hitld dispatch follow-up/);
  assert.equal(missing.queued_to_merge, 'hitld/W-1-add-numbers', 'flagged, still queued');

  const noted = await work(
    'W-4',
    'work/items/W-4-wide.md',
    { 'src/calc.js': 'export const add = (a, b) => b + a;\n' },
    'add takes its arguments in either order',
  );
  assert.equal(noted.release_note_missing, undefined);

  const internal = await work('W-5', 'work/items/W-5-named.md', {
    'src/named.js': 'export const named = 2;\n',
  });
  assert.equal(internal.release_note_missing, undefined, 'no public file changed');
});
