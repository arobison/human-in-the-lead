import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { VERSION } from '../lib/version.mjs';
import { HEADINGS, FORM_OF, renderIssueBody } from '../lib/feedback/render.mjs';
import { feedbackRecordsIn } from '../lib/feedback/guard.mjs';
import { checkRecord } from '../lib/feedback/record.mjs';
import { schemas } from '../lib/schema/registry.mjs';

const root = mkdtempSync(join(tmpdir(), 'hitld-feedback-'));
const repo = join(root, 'repo');
const store = join(root, 'store');
mkdirSync(repo);
execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repo });

/** @param {string[]} argv @param {string} [cwd] */
async function hitld(argv, cwd = repo) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: {} });
  return { code, json: JSON.parse(out) };
}

const ledger = [
  {
    event: 'dispatched',
    id: 'E-1',
    dispatch: 'D-3',
    item: 'W-9',
    schema_version: 1,
    at: '2026-11-14T10:00:00Z',
  },
  {
    event: 'reported',
    id: 'E-2',
    dispatch: 'D-3',
    item: 'W-9',
    result: 'done',
    schema_version: 1,
    at: '2026-11-14T11:00:00Z',
  },
];
mkdirSync(store);
writeFileSync(join(store, 'ledger.jsonl'), ledger.map((e) => JSON.stringify(e)).join('\n') + '\n');

test('feedback: a record holds the words verbatim and the context the person did not type', async () => {
  const words = '  "That question" was not worth asking; $(not run) ☃ ';
  const r = await hitld([
    'feedback',
    '--kind',
    'friction',
    '--words',
    words,
    '--refs',
    'D-3,W-9',
    '--expected',
    'No question',
    '--store',
    store,
    '--json',
  ]);
  assert.equal(r.code, 0);
  const rec = r.json.record;
  assert.equal(rec.id, 'FB-1');
  assert.equal(rec.words, words);
  assert.equal(rec.version, VERSION);
  assert.deepEqual(rec.harness, { name: 'claude-code', version: 'unknown' });
  assert.equal(rec.area, 'dispatch');
  assert.deepEqual(rec.refs, ['D-3', 'W-9']);
  assert.match(rec.what_happened, /dispatched, reported/);
  assert.equal(rec.evidence.length, 2);
  assert.equal(rec.classification, 'confidential');
  assert.equal(rec.state, 'local');
  assert.deepEqual(
    checkRecord(JSON.parse(readFileSync(join(store, 'feedback', 'FB-1.json'), 'utf8'))),
    [],
  );
});

test('feedback: --area wins, harness details are taken as given, an unmatched ref is said', async () => {
  const r = await hitld([
    'feedback',
    '--kind',
    'idea',
    '--words',
    'w',
    '--refs',
    'D-77',
    '--area',
    'merge queue',
    '--harness',
    'copilot',
    '--harness_version',
    '1.2',
    '--store',
    store,
    '--json',
  ]);
  assert.equal(r.json.record.id, 'FB-2');
  assert.equal(r.json.record.area, 'merge queue');
  assert.deepEqual(r.json.record.harness, { name: 'copilot', version: '1.2' });
  assert.deepEqual(r.json.unmatched_refs, ['D-77']);
});

test('feedback: a malformed ref is an error that names it, and writes nothing', async () => {
  const before = readdirSync(join(store, 'feedback')).length;
  const r = await hitld([
    'feedback',
    '--kind',
    'bug',
    '--words',
    'w',
    '--refs',
    'D-3,oops,12',
    '--store',
    store,
  ]);
  assert.equal(r.code, 1);
  assert.match(r.json.message, /"oops"/);
  assert.match(r.json.message, /"12"/);
  assert.equal(readdirSync(join(store, 'feedback')).length, before);
});

test('feedback: an unknown kind and empty words are refused', async () => {
  assert.equal(
    (await hitld(['feedback', '--kind', 'praise', '--words', 'w', '--store', store])).code,
    1,
  );
  assert.equal(
    (await hitld(['feedback', '--kind', 'bug', '--words', ' ', '--store', store])).code,
    1,
  );
});

test('feedback: a store in the repository, or in a worktree, is refused', async () => {
  const inside = await hitld([
    'feedback',
    '--kind',
    'bug',
    '--words',
    'w',
    '--store',
    join(repo, '.store'),
  ]);
  assert.equal(inside.code, 1);
  assert.match(inside.json.message, /inside the repository or a worktree/);
  assert.equal(existsSync(join(repo, '.store')), false);

  writeFileSync(join(repo, 'a.txt'), 'x');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@e.x',
      'commit',
      '-q',
      '-m',
      'x',
    ],
    { cwd: repo },
  );
  const wt = join(root, 'wt');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'side', wt], { cwd: repo });
  const fromWt = await hitld(
    ['feedback', '--kind', 'bug', '--words', 'w', '--store', join(wt, 'store')],
    wt,
  );
  assert.equal(fromWt.code, 1);
  // From the repository, a store in the linked worktree is refused too.
  const toWt = await hitld([
    'feedback',
    '--kind',
    'bug',
    '--words',
    'w',
    '--store',
    join(wt, 'store'),
  ]);
  assert.equal(toWt.code, 1);
  assert.equal(existsSync(join(wt, 'store')), false);
});

test('feedback: a link inside the store that leads into the repository is refused', async () => {
  const linked = join(root, 'linked');
  mkdirSync(linked);
  mkdirSync(join(repo, 'trap'));
  symlinkSync(join(repo, 'trap'), join(linked, 'feedback'));
  const r = await hitld(['feedback', '--kind', 'bug', '--words', 'w', '--store', linked]);
  assert.equal(r.code, 1);
  assert.deepEqual(readdirSync(join(repo, 'trap')), []);
});

test('feedback list shows waiting records; drop marks one dropped and list stops showing it', async () => {
  const before = await hitld(['feedback', 'list', '--store', store]);
  assert.deepEqual(
    before.json.records.map((/** @type {any} */ r) => r.id),
    ['FB-1', 'FB-2'],
  );
  const dropped = await hitld(['feedback', 'drop', 'FB-1', '--store', store]);
  assert.equal(dropped.json.state, 'dropped');
  const after = await hitld(['feedback', 'list', '--store', store]);
  assert.deepEqual(
    after.json.records.map((/** @type {any} */ r) => r.id),
    ['FB-2'],
  );
  const all = await hitld(['feedback', 'list', '--all', '--store', store]);
  assert.equal(all.json.records.length, 2);
  assert.equal((await hitld(['feedback', 'drop', 'FB-1', '--store', store])).json.changed, false);
  assert.equal((await hitld(['feedback', 'drop', 'FB-99', '--store', store])).code, 1);
  assert.equal((await hitld(['feedback', 'drop', 'nope', '--store', store])).code, 1);
});

test('feedback list reports a damaged record instead of skipping it', async () => {
  writeFileSync(join(store, 'feedback', 'FB-8.json'), '{"schema_version":1,"surprise":true}');
  const r = await hitld(['feedback', 'list', '--store', store]);
  assert.equal(r.code, 1);
  assert.equal(r.json.problems[0].key, 'feedback/FB-8.json');
});

test('the record schema: rejects unknown keys and any classification but confidential; state rules', () => {
  const base = JSON.parse(readFileSync(join(store, 'feedback', 'FB-2.json'), 'utf8'));
  assert.deepEqual(checkRecord(base), []);
  assert.notEqual(checkRecord({ ...base, surprise: 1 }).length, 0);
  assert.notEqual(checkRecord({ ...base, classification: 'public' }).length, 0);
  assert.notEqual(checkRecord({ ...base, kind: 'feature' }).length, 0);
  assert.notEqual(checkRecord({ ...base, state: 'filed' }).length, 0);
  assert.notEqual(
    checkRecord({ ...base, state: 'filed', url: 'https://example.test/i/1' }).length,
    0,
    'a filed record needs its draft and approval',
  );
  const draft = {
    title: 't',
    what_happened: 'w',
    classification: 'public',
    drafted_at: '2026-11-14T10:00:00.000Z',
  };
  const approval = {
    by: 'owner',
    at: '2026-11-14T10:00:00.000Z',
    via: 'main-session',
    mode: 'approve',
    answer: 'approve',
  };
  assert.deepEqual(
    checkRecord({ ...base, state: 'filed', url: 'https://example.test/i/1', draft, approval }),
    [],
  );
  assert.notEqual(checkRecord({ ...base, state: 'drafted' }).length, 0);
  assert.deepEqual(checkRecord({ ...base, state: 'drafted', draft }), []);
  assert.notEqual(checkRecord({ ...base, state: 'drafted', draft, approval }).length, 0);
  assert.deepEqual(
    checkRecord({ ...base, state: 'drafted', draft, approval: { ...approval, mode: 'by-hand' } }),
    [],
  );
  assert.notEqual(checkRecord({ ...base, state: 'withheld' }).length, 0);
  assert.deepEqual(checkRecord({ ...base, state: 'withheld', reason: 'not public' }), []);
  assert.notEqual(checkRecord({ ...base, url: 'https://example.test/i/1' }).length, 0);
});

test('signal kinds include friction and worked-well', () => {
  for (const kind of ['friction', 'worked-well']) {
    const errors = schemas().validateEntity('signal', {
      schema_version: 1,
      id: 'SIG-1',
      source: 's',
      received_at: '2026-11-14',
      kind,
      state: 'new',
      classification: 'public',
    });
    assert.deepEqual(errors, [], kind);
  }
});

/**
 * The labels of a form's fields, in order, read from the YAML without a parser: a label under a
 * field that is not the confirmation checkbox.
 * @param {string} file
 */
function formHeadings(file) {
  const text = readFileSync(
    new URL(`../../.github/ISSUE_TEMPLATE/${file}`, import.meta.url),
    'utf8',
  );
  return [...text.matchAll(/^ {2}- type: (\w+)\n(?:.*\n)*?\s+label: '?([^'\n]+)'?$/gm)]
    .filter((m) => m[1] !== 'checkboxes')
    .map((m) => m[2]);
}

for (const [kind, file] of Object.entries(FORM_OF)) {
  test(`render: the headings match the ${kind} form, in order`, () => {
    assert.deepEqual(formHeadings(file), [...HEADINGS]);
    const rec = JSON.parse(readFileSync(join(store, 'feedback', 'FB-2.json'), 'utf8'));
    const body = renderIssueBody({ ...rec, kind });
    assert.deepEqual(
      [...body.matchAll(/^### (.+)$/gm)].map((m) => m[1]),
      [...HEADINGS],
    );
  });
}

test('render: the command prints the body with the person words and the evidence', async () => {
  const r = await hitld(['feedback', 'render', 'FB-2', '--store', store]);
  assert.equal(r.code, 0);
  assert.match(r.json.body, /### What happened\n\nw\n/);
  assert.match(r.json.body, /### Harness\n\nGitHub Copilot 1\.2\n/);
  assert.match(r.json.body, /### Evidence\n\n_No response_/);
  assert.equal(r.json.classification, 'confidential');
});

test('the tracker check finds a feedback record in a repository', () => {
  assert.deepEqual(feedbackRecordsIn(repo), []);
  mkdirSync(join(repo, 'feedback'));
  writeFileSync(join(repo, 'feedback', 'FB-1.json'), '{}');
  writeFileSync(join(repo, 'feedback', 'notes.md'), 'x');
  assert.deepEqual(feedbackRecordsIn(repo), ['feedback/FB-1.json']);
});
