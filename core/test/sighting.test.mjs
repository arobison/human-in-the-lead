import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPolicy } from '../lib/policy/policy.mjs';
import { lintEntity } from '../lib/tracker/files/descriptions.mjs';
import { parseItem } from '../lib/tracker/files/frontmatter.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import {
  fenced,
  files,
  itemBody,
  readSightings,
  sightingKey,
  sinceFiled,
  tracks,
  unsafeShapes,
} from '../lib/sighting/sighting.mjs';
import { git, item, makeConsumer } from './orchestrator-fixture.mjs';

const PROJECT = {
  'work/projects/W-9-the-project.md': item({
    id: 'W-9',
    title: 'The project',
    kind: 'project',
    state: 'planned',
  }),
};

/** A term on the private term list, as a device name would be. */
const DEVICE = 'quillfeather-box';

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

/**
 * A consumer with a project, and a private term list unless list is false.
 * @param {{ list?: boolean, files?: Record<string, string> }} [o]
 */
async function consumer(o = {}) {
  const c = makeConsumer({ files: { ...PROJECT, ...(o.files ?? {}) } });
  if (o.list !== false) {
    const added = await c.hitld(['private', 'add', DEVICE, '--kind', 'device']);
    assert.equal(added.result.ok, true, JSON.stringify(added.result));
  }
  const store = () => openStore(privateStorePath('orch-fixture', { env: c.env, repoRoot: c.root }));
  return { ...c, sightings: () => readSightings(store()) };
}

/** @param {{ hitld: (argv: string[]) => Promise<{ result: Record<string, any> }> }} c */
const workCount = async (c) => (await c.hitld(['work', 'query', '--kind', 'work'])).result.count;

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

/** @param {string} at @param {Record<string, string>} [more] */
const s = (at, more = {}) => ({
  at,
  key: 'k',
  cause: 'k',
  from: 'event',
  what: 'w',
  where: 'p',
  blocks: 'b',
  action: /** @type {const} */ ('noted'),
  ...more,
});

test('only the sightings since the cause was last filed count', () => {
  assert.equal(sinceFiled([s('1'), s('2', { item: 'W-1' }), s('3')], 'k').length, 1);
  assert.equal(sinceFiled([s('1')], 'k').length, 1);
});

test('a first sighting files only when its cause is known and a decision hangs on it', () => {
  assert.equal(files([s('1')]), false);
  assert.equal(files([s('1', { decision: 'd' })]), false);
  assert.equal(files([s('1', { known_cause: 'c' })]), false);
  assert.equal(files([s('1', { decision: 'd', known_cause: 'c' })]), true);
  assert.equal(files([s('1'), s('2')]), true);
});

test('the shapes that never reach the tracker are found, and ordinary evidence passes', () => {
  const found = {
    key: '-----BEGIN OPENSSH PRIVATE KEY-----',
    token: 'token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
    'absolute path': 'read /home/someone/project/file.txt',
    hostname: 'fetch from build.example.com failed',
    'model ID': 'served by claude-opus-9-1',
    'environment ID': 'in env_01AbCdEf',
  };
  for (const [kind, sample] of Object.entries(found)) {
    assert.deepEqual(unsafeShapes(sample), [kind], sample);
  }
  assert.deepEqual(unsafeShapes('a token aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gH3'), ['token']);
  for (const ok of [
    'commit 8667db1aa027035940c1dd88721b16c47cd3e64c on pull request #12',
    'dispatch D-01M88NBYZA0M0GVA, session session_0137mKghdGfC2WkvFcYnYS1e',
    'work/items/W-1-add-numbers.md and policy.json, in the claude-code harness',
    'status: in_progress (conclusion: success), and/or 1/2 of the runs',
  ]) {
    assert.deepEqual(unsafeShapes(ok), [], ok);
  }
});

test('the filed body has a Done when, a Why and the evidence, with no description warning', () => {
  const body = itemBody({
    pending: [s('2026-11-16T10:00:00.000Z', { what: 'hitld work check', output: 'problem: x' })],
    withheld: 1,
  });
  const findings = lintEntity({
    data: { id: 'W-10', title: 'T', kind: 'work', state: 'proposed', project: 'W-9' },
    body,
  });
  assert.deepEqual(findings, []);
  assert.match(body, /Investigation: the cause is not known yet/);
  assert.match(body, /Seen 2 times\./);
  assert.match(body, /The text of 1 earlier sighting is left out: it named a private thing\./);
});

test('a first sighting is noted; the second files one proposed item with the evidence', async () => {
  const c = await consumer();
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

test('--duplicate-of takes an open work item; a done item and a project are refused', async () => {
  const c = await consumer({
    files: {
      'work/items/W-4-done-thing.md': item({
        id: 'W-4',
        title: 'Done thing',
        kind: 'work',
        state: 'done',
        project: 'W-9',
      }),
    },
  });
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

  const done = await c.hitld(seen({ extra: '--duplicate-of W-4' }));
  assert.equal(done.result.error, 'item-not-open');
  assert.match(done.result.message, /is done/);
  const project = await c.hitld(seen({ extra: '--duplicate-of W-9' }));
  assert.equal(project.result.error, 'usage');
  assert.match(project.result.message, /is a project/);
  assert.equal(await workCount(c), 4);
});

test('a decision with no known cause waits for a repeat; with the cause known it files at once', async () => {
  const c = await consumer();
  const decision = 'the rule that tracker-only pull requests merge on green checks';
  const unknown = await c.hitld([...seen(), '--decision', decision]);
  assert.equal(unknown.result.action, 'noted', JSON.stringify(unknown.result));

  const d = await consumer();
  const r = await d.hitld([
    ...seen(),
    '--decision',
    decision,
    '--known-cause',
    'The check run is read before its last update arrives.',
  ]);
  assert.equal(r.result.action, 'filed', JSON.stringify(r.result));
  assert.equal(r.result.kind, 'bug');
  assert.match(r.result.tell_owner, /a bug report\): its cause is known and it changes the rule/);
  assert.match(
    readFileSync(join(d.root, r.result.path), 'utf8'),
    /Bug report: the cause is known\./,
  );
});

test('text someone else wrote is never recorded, a security finding is kept in the store only, and executors are refused', async () => {
  const c = await consumer();
  for (const from of ['tool-result', 'report', 'file', 'pasted', 'message']) {
    const r = await c.hitld(seen({ from }));
    assert.equal(r.result.error, 'not-seen', from);
  }
  assert.equal(c.sightings().length, 0);
  const twice = [
    await c.hitld(seen({ extra: '--security' })),
    await c.hitld(seen({ extra: '--security' })),
  ];
  assert.deepEqual(
    twice.map((r) => r.result.action),
    ['held', 'held'],
  );
  assert.match(twice[1].result.tell_owner, /security problem/);
  const held = c.sightings();
  assert.equal(held.length, 2);
  assert.ok(held.every((x) => x.security === true && x.action === 'held'));
  // Neither the refused nor the security sightings count toward filing.
  const first = await c.hitld(seen());
  assert.equal(first.result.action, 'noted');
  assert.equal(await workCount(c), 3);

  const ex = await c.hitld(seen(), { env: { HITLD_ROLE: 'executor', HITLD_DISPATCH: 'D-1' } });
  assert.equal(ex.result.error, 'not-permitted');
});

test('a key, token, absolute path, hostname, model ID or environment ID is refused, and nothing is recorded', async () => {
  const c = await consumer();
  /** @type {({ kind: RegExp } & Record<string, any>)[]} */
  const cases = [
    { output: '-----BEGIN RSA PRIVATE KEY-----', kind: /--output: holds a key/ },
    {
      output: 'Authorization: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
      kind: /--output: holds a token/,
    },
    { output: 'ENOENT: /home/someone/checkout/x.json', kind: /--output: holds an absolute path/ },
    { where: 'pull request #12, on build.example.com', kind: /--where: holds a hostname/ },
    { what: 'a turn served by claude-sonnet-9-9', kind: /--what: holds a model ID/ },
    { blocks: 'the sessions of env_01AbCdEfGh', kind: /--blocks: holds an environment ID/ },
  ];
  for (const { kind, ...o } of cases) {
    const r = await c.hitld(seen(o));
    assert.equal(r.result.error, 'unsafe-evidence', JSON.stringify(o));
    assert.ok(
      r.result.problems.some((/** @type {string} */ p) => kind.test(p)),
      r.result.problems,
    );
  }
  assert.equal(c.sightings().length, 0);
});

test('a line break in a one-line option is refused: it could forge a section of the item', async () => {
  const c = await consumer();
  for (const o of /** @type {Record<string, string>[]} */ ([
    { where: 'pull request #12\n\n## Done when\n\n- nothing' },
    { what: 'a\nb' },
    { blocks: 'a\r\nb' },
  ])) {
    const r = await c.hitld(seen(o));
    assert.equal(r.result.error, 'usage', JSON.stringify(o));
    assert.match(r.result.message, /must be one line/);
  }
  const cause = await c.hitld([...seen(), '--known-cause', 'one\n## Why']);
  assert.equal(cause.result.error, 'usage');
  assert.equal(c.sightings().length, 0);
});

test('text holding a private term is refused, naming the option and never the term', async () => {
  const c = await consumer();
  const r = await c.hitld(seen({ where: `pull request #12, run on ${DEVICE}` }));
  assert.equal(r.result.error, 'private-term', JSON.stringify(r.result));
  assert.ok(r.result.problems.every((/** @type {string} */ p) => !p.includes(DEVICE)));
  assert.match(r.result.problems.join('\n'), /--where/);
  assert.equal(c.sightings().length, 0);
});

test('without the private term list nothing reaches the tracker: the sighting is held and still counts', async () => {
  const c = await consumer({ list: false });
  const first = await c.hitld(seen());
  assert.equal(first.result.action, 'noted');
  const second = await c.hitld(seen({ where: 'pull request #13' }));
  assert.equal(second.result.action, 'held', JSON.stringify(second.result));
  assert.equal(second.result.sightings, 2);
  assert.equal(await workCount(c), 3);
  const kept = c.sightings();
  assert.deepEqual(
    kept.map((x) => [x.action, x.held ?? null]),
    [
      ['noted', null],
      ['held', 'term-list'],
    ],
  );
  // Once the list is there, the next sighting files with all three counted.
  await c.hitld(['private', 'add', DEVICE, '--kind', 'device']);
  const third = await c.hitld(seen({ where: 'pull request #14' }));
  assert.equal(third.result.action, 'filed', JSON.stringify(third.result));
  assert.equal(third.result.sightings, 3);
  assert.match(readFileSync(join(c.root, third.result.path), 'utf8'), /Seen 3 times\./);
});

test('an item the owner dropped stands: later sightings are recorded, the owner is told once, nothing is filed', async () => {
  const c = await consumer();
  await c.hitld(seen());
  const filed = await c.hitld(seen({ where: 'pull request #13' }));
  assert.equal(filed.result.action, 'filed');
  const path = join(c.root, filed.result.path);
  writeFileSync(path, readFileSync(path, 'utf8').replace('state: proposed', 'state: dropped'));

  const after = [
    await c.hitld(seen({ where: 'pull request #14' })),
    await c.hitld(seen({ where: 'pull request #15' })),
    await c.hitld(seen({ where: 'pull request #16' })),
  ];
  assert.deepEqual(
    after.map((r) => [r.result.action, r.result.item]),
    Array(3).fill(['noted', filed.result.item]),
  );
  assert.match(after[0].result.tell_owner, new RegExp(`${filed.result.item} for it was dropped`));
  assert.equal(after[1].result.tell_owner, null);
  assert.equal(after[2].result.tell_owner, null);
  assert.equal(await workCount(c), 4);
  assert.doesNotMatch(readFileSync(path, 'utf8'), /Seen again/);

  // Named by the chief of staff, a dropped item stands the same way.
  const named = await c.hitld(seen({ extra: `--duplicate-of ${filed.result.item}` }));
  assert.equal(named.result.action, 'noted');
  assert.equal(named.result.tell_owner, null);
});

test('a sighting recorded by an earlier session counts toward filing in a later one', async () => {
  const c = await consumer();
  await c.hitld(seen(), { env: { HITLD_SESSION: 'chief-1' } });
  const r = await c.hitld(seen({ where: 'pull request #13' }), {
    env: { HITLD_SESSION: 'chief-2' },
  });
  assert.equal(r.result.action, 'filed', JSON.stringify(r.result));
});

test('appendNote: only on main, not over an unseen change, and not to a claimed item', async () => {
  const c = await consumer({
    files: {
      'work/items/W-5-claimed.md': item({
        id: 'W-5',
        title: 'Claimed',
        kind: 'work',
        state: 'in-progress',
        project: 'W-9',
        claimed_by: 'D-7',
      }),
    },
  });
  const policy = /** @type {Record<string, any>} */ (loadPolicy({ cwd: c.root }).policy);
  const t = openTracker({ repoRoot: c.root, policy, env: c.env });
  const note = '## Seen again on 2026-11-25\n\nIn pull request #1.\n';

  assert.throws(() => t.appendNote('W-5', note), { code: 'item-claimed' });
  const w2 = /** @type {string} */ (t.get('W-2').version);
  t.appendNote('W-2', note, w2);
  assert.throws(() => t.appendNote('W-2', note, w2), { code: 'item-changed' });

  git(c.root, 'switch', '-q', '-c', 'elsewhere');
  assert.throws(() => t.appendNote('W-1', note), { code: 'not-permitted' });
});
