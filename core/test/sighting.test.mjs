import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintEntity } from '../lib/tracker/files/descriptions.mjs';
import { parseItem } from '../lib/tracker/files/frontmatter.mjs';
import { fenced, itemBody, sightingKey, sinceFiled, tracks } from '../lib/sighting/sighting.mjs';
import { item, makeConsumer } from './orchestrator-fixture.mjs';

const PROJECT = {
  'work/projects/W-9-the-project.md': item({
    id: 'W-9',
    title: 'The project',
    kind: 'project',
    state: 'planned',
  }),
};

/** A sighting of the same cause, from the chief of staff's own command. */
const seen = (/** @type {Record<string, string>} */ o = {}) => [
  'work',
  'sighting',
  '--cause',
  o.cause ?? 'The tracker check run reads in_progress after it succeeded',
  '--from',
  o.from ?? 'event',
  '--what',
  o.what ?? 'check run "tracker" on the pull request',
  '--output',
  o.output ?? 'status: in_progress (conclusion: success)',
  '--where',
  o.where ?? 'pull request #12',
  '--blocks',
  o.blocks ?? 'merging tracker-only pull requests on green checks',
  '--parent',
  'W-9',
  ...(o.extra ? o.extra.split(' ') : []),
];

test('the key ignores case and punctuation; an item tracks the key on its own line', () => {
  assert.equal(
    sightingKey('  The CHECK run: reads in_progress! '),
    'the check run reads in progress',
  );
  assert.equal(tracks('x\nSighting key: `a b`\n', 'a b'), true);
  assert.equal(tracks('Sighting key: `a b c`', 'a b'), false);
});

test('a fence is longer than any run of backticks in the output, and long output is cut', () => {
  assert.match(fenced('a ``` b'), /^````text\n/);
  assert.match(fenced('x'.repeat(2000)), /\[cut\]\n```$/);
});

test('only the sightings since the cause was last filed count', () => {
  const s = (/** @type {string} */ at, /** @type {string} */ item = '') => ({
    at,
    key: 'k',
    cause: 'k',
    from: 'event',
    what: 'w',
    where: 'p',
    blocks: 'b',
    action: /** @type {const} */ ('noted'),
    ...(item ? { item } : {}),
  });
  assert.equal(sinceFiled([s('1'), s('2', 'W-1'), s('3')], 'k').length, 1);
  assert.equal(sinceFiled([s('1')], 'k').length, 1);
});

test('the filed body has a Done when, a Why and the evidence, with no description warning', () => {
  const body = itemBody({
    pending: [
      {
        at: '2026-11-16T10:00:00.000Z',
        key: 'k',
        cause: 'k',
        from: 'command',
        what: 'hitld work check',
        output: 'problem: x',
        where: 'dispatch D-1',
        blocks: 'the merge queue',
        action: 'noted',
      },
    ],
  });
  const findings = lintEntity({
    data: { id: 'W-10', title: 'T', kind: 'work', state: 'proposed', project: 'W-9' },
    body,
  });
  assert.deepEqual(findings, []);
  assert.match(body, /Investigation: the cause is not known yet/);
});

test('a first sighting is noted; the second files one proposed item with the evidence', async () => {
  const c = makeConsumer({ files: PROJECT });
  const first = await c.hitld(seen());
  assert.equal(first.exit, 0, JSON.stringify(first.result));
  assert.equal(first.result.action, 'noted');
  assert.equal(first.result.item, undefined);

  const second = await c.hitld(seen({ where: 'pull request #13' }));
  assert.equal(second.result.action, 'filed', JSON.stringify(second.result));
  assert.equal(second.result.kind, 'investigation');
  assert.match(
    second.result.tell_owner,
    /^Filed W-\d+: .* \(proposed, an investigation\): seen 2 times/,
  );
  const text = readFileSync(join(c.root, second.result.path), 'utf8');
  const { data, body } = parseItem(text);
  assert.equal(data?.state, 'proposed');
  assert.match(body, /## Done when\n\n- /);
  assert.match(body, /pull request #12/);
  assert.match(body, /pull request #13/);
  assert.match(body, /status: in_progress \(conclusion: success\)/);
  assert.match(body, /Seen 2 times\./);
  assert.match(body, /Blocks: merging tracker-only pull requests on green checks/);

  // A third sighting, worded differently, goes to the same item: nothing new is filed.
  const third = await c.hitld(
    seen({
      cause: 'the tracker check-run reads IN_PROGRESS after it succeeded.',
      where: 'pull request #14',
    }),
  );
  assert.equal(third.result.action, 'appended');
  assert.equal(third.result.item, second.result.item);
  assert.equal(third.result.sightings, 3);
  assert.equal(third.result.tell_owner, null);
  const after = readFileSync(join(c.root, second.result.path), 'utf8');
  assert.match(
    after,
    /## Seen again on \d{4}-\d{2}-\d{2}\n\nIn pull request #14\. Sightings recorded so far: 3\./,
  );
  assert.equal(parseItem(after).data?.state, 'proposed');

  // The fixture's own items have no project; the filed one adds no problem and no description warning.
  const check = await c.hitld(['work', 'check']);
  const filed = String(second.result.path);
  assert.deepEqual(
    [...check.result.problems, ...check.result.warnings].filter(
      (/** @type {string} */ l) => l.startsWith(filed) && !/under no milestone/.test(l),
    ),
    [],
  );
});

test('an item the chief of staff names as tracking it gets the evidence, and nothing is filed', async () => {
  const c = makeConsumer({ files: PROJECT });
  const r = await c.hitld(seen({ extra: '--duplicate-of W-2' }));
  assert.equal(r.result.action, 'appended', JSON.stringify(r.result));
  assert.equal(r.result.item, 'W-2');
  assert.match(
    readFileSync(join(c.root, 'work/items/W-2-another-thing.md'), 'utf8'),
    /## Seen again on/,
  );
  // The item now carries the cause's key, so the next sighting finds it without being told.
  const again = await c.hitld(seen({ where: 'pull request #13' }));
  assert.equal(again.result.action, 'appended');
  assert.equal(again.result.item, 'W-2');
  const list = await c.hitld(['work', 'query', '--kind', 'work']);
  assert.equal(list.result.count, 3);
});

test('a first sighting that changes a decision files at once, as a bug report when the cause is known', async () => {
  const c = makeConsumer({ files: PROJECT });
  const r = await c.hitld([
    ...seen(),
    '--decision',
    'the rule that tracker-only pull requests merge on green checks',
    '--known-cause',
    'The check run is read before its last update arrives.',
  ]);
  assert.equal(r.result.action, 'filed', JSON.stringify(r.result));
  assert.equal(r.result.kind, 'bug');
  assert.match(r.result.tell_owner, /a bug report\): it changes the rule/);
  assert.match(
    readFileSync(join(c.root, r.result.path), 'utf8'),
    /Bug report: the cause is known\./,
  );
});

test('text someone else wrote is never recorded, a security finding stays out of the tracker, and executors are refused', async () => {
  const c = makeConsumer({ files: PROJECT });
  for (const from of ['tool-result', 'report', 'file', 'pasted', 'message']) {
    const r = await c.hitld(seen({ from }));
    assert.equal(r.result.error, 'not-seen', from);
  }
  const twice = [
    await c.hitld(seen({ extra: '--security' })),
    await c.hitld(seen({ extra: '--security' })),
  ];
  assert.deepEqual(
    twice.map((r) => r.result.action),
    ['held', 'held'],
  );
  assert.match(twice[1].result.tell_owner, /security problem/);
  // Neither the refused nor the security sightings count toward filing.
  const first = await c.hitld(seen());
  assert.equal(first.result.action, 'noted');
  const list = await c.hitld(['work', 'query', '--kind', 'work']);
  assert.equal(list.result.count, 3);

  const ex = await c.hitld(seen(), { env: { HITLD_ROLE: 'executor', HITLD_DISPATCH: 'D-1' } });
  assert.equal(ex.result.error, 'not-permitted');
});

test('a sighting recorded by an earlier session counts toward filing in a later one', async () => {
  const c = makeConsumer({ files: PROJECT });
  await c.hitld(seen(), { env: { HITLD_SESSION: 'chief-1' } });
  const r = await c.hitld(seen({ where: 'pull request #13' }), {
    env: { HITLD_SESSION: 'chief-2' },
  });
  assert.equal(r.result.action, 'filed', JSON.stringify(r.result));
});
