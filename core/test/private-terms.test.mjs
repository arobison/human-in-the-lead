// The private term list (design part 10.3, rule 7): kept in the private store, matched in the
// pre-commit and commit-msg hooks, at merge over every commit's files and message, in hitld work
// check and in hitld publish check; and CI's check of what needs no list. No output names a term.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addressTerms,
  commitMessageText,
  compileTerms,
  findEmails,
  findTerms,
  guessKind,
  isNoreply,
  termKey,
  termProblem,
  urlCore,
} from '../lib/guard/private-terms.mjs';
import { STRICT, checkCommits, checkStaged } from '../lib/guard/classification.mjs';
import {
  TERMS_KEY,
  activeTerms,
  addTerm,
  loadTerms,
  readTermRecords,
  recordAddress,
  removeTerm,
} from '../lib/store/private-terms.mjs';
import { APPROVALS_KEY } from '../lib/store/devices.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { checkPublicRange, formatPublicReport } from '../lib/guard/public-check.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { git, makeConsumer, put } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));
// Placeholders only: a host on a domain reserved for examples, and made-up names.
const ADDRESS = 'https://git.example.com/example-owner/sample-store.git';
const DEVICE = 'sample-laptop-7';
const NAME = 'Example Partner Co';
// Addresses on made-up domains that are not reserved for examples, which is what the email check
// looks for. Built here, so no line of this file holds one for that check to find.
const PERSON = ['person', 'company-sample.io'].join('@');
const BOSS = ['boss', 'firm-sample.co'].join('@');

/** @param {string} text @param {import('../lib/guard/private-terms.mjs').Term[]} terms */
const kinds = (text, terms) => findTerms(text, compileTerms(terms)).map((m) => m.kind);

/** Every string in a value, joined, to check nothing in it holds a term. @param {unknown} v */
const allText = (v) => JSON.stringify(v);

// --- Matching ------------------------------------------------------------------------------

test('a URL term matches with or without its scheme, user, port, .git and trailing slash, in any case', () => {
  const terms = addressTerms(ADDRESS);
  assert.deepEqual(
    terms.map((t) => [t.kind, t.term]),
    [
      ['store-address', ADDRESS],
      ['repository', 'example-owner/sample-store'],
      ['repository', 'sample-store'],
    ],
  );
  for (const spelling of [
    ADDRESS,
    'git.example.com/example-owner/sample-store',
    'git@git.example.com:example-owner/sample-store.git',
    'ssh://git@git.example.com:22/example-owner/sample-store/',
    'HTTPS://Git.Example.COM/Example-Owner/Sample-Store',
    'https://git.example.com/example-owner/sample-store/issues/4',
  ]) {
    assert.deepEqual(
      kinds(`see ${spelling} for it`, terms.slice(0, 1)),
      ['store-address'],
      spelling,
    );
  }
  assert.deepEqual(kinds('git.example.com/example-owner/sample-store-two', terms.slice(0, 1)), []);
  assert.deepEqual(kinds('notgit.example.com/example-owner/sample-store', terms.slice(0, 1)), []);
  assert.equal(urlCore('git@host.example:o/r.git/'), 'host.example/o/r');
  assert.equal(urlCore('file:///srv/git/store.git'), '/srv/git/store');
  assert.equal(termKey(ADDRESS), termKey('git@git.example.com:example-owner/sample-store'));
});

test('a word term matches whole words without regard to case; one place gives one match', () => {
  const terms = [
    { term: DEVICE, kind: 'device' },
    { term: NAME, kind: 'name' },
  ];
  assert.deepEqual(kinds(`on ${DEVICE.toUpperCase()}.`, terms), ['device']);
  assert.deepEqual(kinds(`${DEVICE}x and x${DEVICE}`, terms), []);
  assert.deepEqual(kinds('example  partner\nco', terms), ['name']);
  assert.deepEqual(kinds('examplepartnerco', terms), []);
  // An address and its owner/name overlap: the address is what is reported.
  const found = findTerms(
    `at ${ADDRESS}\nand example-owner/sample-store`,
    compileTerms(addressTerms(ADDRESS)),
  );
  assert.deepEqual(
    found.map((f) => [f.line, f.kind]),
    [
      [1, 'store-address'],
      [2, 'repository'],
    ],
  );
});

test('the list refuses a term too short, with a control character, or of an unknown kind', () => {
  assert.match(String(termProblem('ab')), /at least 3/);
  assert.match(String(termProblem('a\nb c')), /one line/);
  assert.match(String(termProblem('fine-name', 'secret')), /kind is one of/);
  assert.equal(termProblem('fine-name', 'device'), null);
  assert.equal(guessKind(ADDRESS), 'url');
  assert.equal(guessKind('person@company.example'), 'email');
  assert.equal(guessKind(NAME), 'name');
});

test("emails: noreply ones and placeholders pass; a person's address is found by its line", () => {
  const text = [
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    'Signed-off-by: A <12+a@users.noreply.github.com>',
    'you@example.com, someone@sub.example.org, x@host.invalid',
    'git@github.com:owner/repo.git and https://user:token@github.com/o/r',
    "writeFileSync('CLAUDE.md', '@AGENTS.md')",
    `mail ${PERSON} or mailto:${BOSS}`,
  ].join('\n');
  assert.deepEqual(
    findEmails(text).map((e) => [e.line, e.email]),
    [
      [6, PERSON],
      [6, BOSS],
    ],
  );
  assert.equal(isNoreply('no-reply@service.example'), true);
  assert.equal(isNoreply(PERSON), false);
});

test('a commit message is checked as git records it: no comment lines, nothing after the scissors', () => {
  const raw = `Subject\n# ${DEVICE} in a comment\nBody\n# ------------------------ >8 ------------------------\n+${DEVICE}\n`;
  assert.equal(commitMessageText(raw), 'Subject\n\nBody');
  assert.equal(commitMessageText(`; note\nkept`, ';'), '\nkept');
});

// --- The list in the private store ---------------------------------------------------------

test('the list: add once in any spelling, remove by ID or term, and a damaged line fails closed', () => {
  const store = openStore(tempDir('hitld-terms-'));
  const a = addTerm(store, { term: DEVICE, kind: 'device' });
  assert.equal(a.added, true);
  assert.match(a.id, /^PT-[0-9a-f]{12}$/);
  assert.equal(addTerm(store, { term: DEVICE.toUpperCase() }).added, false);
  const added = recordAddress(store, ADDRESS);
  assert.deepEqual(
    added.map((t) => [t.kind, t.added]),
    [
      ['store-address', true],
      ['repository', true],
      ['repository', true],
    ],
  );
  assert.equal(
    recordAddress(store, 'git@git.example.com:example-owner/sample-store')[0].added,
    false,
  );
  assert.equal(activeTerms(readTermRecords(store)).length, 4);
  assert.equal(removeTerm(store, { which: a.id }).kind, 'device');
  assert.equal(removeTerm(store, { which: 'sample-store' }).kind, 'repository');
  assert.equal(activeTerms(readTermRecords(store)).length, 2);
  assert.throws(() => removeTerm(store, { which: 'sample-store' }), {
    code: 'private-term-unknown',
  });
  assert.throws(() => addTerm(store, { term: 'x' }), { code: 'private-term-invalid' });
  // Another device added the same term: one entry in the list, and removing it removes both.
  const other = {
    schema_version: 1,
    at: '2026-01-01T00:00:00Z',
    event: 'added',
    kind: 'name',
    by: 'owner',
  };
  store.append(TERMS_KEY, `${JSON.stringify({ ...other, id: 'PT-0000000000a1', term: NAME })}\n`);
  store.append(
    TERMS_KEY,
    `${JSON.stringify({ ...other, id: 'PT-0000000000a2', term: NAME.toLowerCase() })}\n`,
  );
  const named = activeTerms(readTermRecords(store)).filter((t) => t.kind === 'name');
  assert.deepEqual(
    named.map((t) => [t.id, t.also]),
    [['PT-0000000000a1', ['PT-0000000000a2']]],
  );
  removeTerm(store, { which: 'PT-0000000000a2' });
  assert.equal(activeTerms(readTermRecords(store)).length, 2);
  store.append(TERMS_KEY, '{"torn":\n');
  assert.throws(() => readTermRecords(store), { code: 'private-list-invalid' });
});

test("implied terms: the store address in use and the device names in the owner's answers", () => {
  const store = openStore(tempDir('hitld-terms-'));
  store.append(
    APPROVALS_KEY,
    `${JSON.stringify({ event: 'approved', decision: 'D-1', action: 'enroll', name: DEVICE, recipient: 'age1x', at: '2026-01-01T00:00:00Z' })}\n`,
  );
  const t = loadTerms({ store, projectId: 'app', env: { HITLD_STORE_REMOTE: ADDRESS } });
  assert.equal(t.listed, 0);
  assert.deepEqual(
    t.terms.map((x) => [x.source, x.kind]),
    [
      ['address', 'store-address'],
      ['address', 'repository'],
      ['device', 'device'],
    ],
  );
  assert.equal(findTerms(`pushed from ${DEVICE}`, t.matchers)[0].source, 'device');
});

// --- The commands ---------------------------------------------------------------------------

test("private add, list and remove are the owner's; list masks each term unless --show", async () => {
  const c = makeConsumer();
  const add = await c.hitld(['private', 'add', NAME]);
  assert.equal(add.exit, 0, JSON.stringify(add.result));
  assert.equal(add.result.kind, 'name');
  assert.ok(!allText(add.result).includes(NAME));
  const list = await c.hitld(['private', 'list']);
  assert.deepEqual(
    list.result.terms.map((/** @type {any} */ t) => [t.kind, t.length, t.term]),
    [['name', NAME.length, '*'.repeat(NAME.length)]],
  );
  assert.ok(!allText(list.result).includes(NAME));
  assert.equal((await c.hitld(['private', 'list', '--show'])).result.terms[0].term, NAME);
  for (const argv of [
    ['private', 'add', 'other-name'],
    ['private', 'list'],
    ['private', 'remove', add.result.id],
  ]) {
    const r = await c.hitld(argv, { env: { HITLD_ROLE: 'executor' } });
    assert.equal(r.result.error, 'not-permitted', argv.join(' '));
  }
  // The list is in the private store, outside the repository.
  const root = privateStorePath('orch-fixture', { env: c.env });
  assert.match(readFileSync(join(root, TERMS_KEY), 'utf8'), /Example Partner Co/);
  assert.equal(git(c.root, 'status', '--porcelain'), '');
  const removed = await c.hitld(['private', 'remove', add.result.id]);
  assert.equal(removed.exit, 0);
  assert.equal((await c.hitld(['private', 'list'])).result.count, 0);
  const git_email = await c.hitld(['private', 'add', '--git-email']);
  assert.equal(git_email.result.ok, true, JSON.stringify(git_email.result));
});

test('publish check refuses a body with a private term, naming kind and line but never the term', async () => {
  const c = makeConsumer();
  await c.hitld(['private', 'add', DEVICE, '--kind', 'device']);
  const body = join(c.base, 'body.md');
  writeFileSync(body, `## Summary\n\nPushed from ${DEVICE} to ${ADDRESS}.\n`);
  const env = { HITLD_STORE_REMOTE: ADDRESS };
  const r = await c.hitld(['publish', 'check', '--file', body], { env });
  assert.equal(r.exit, 1);
  assert.equal(r.result.error, 'private-term');
  assert.deepEqual(
    r.result.refused.map((/** @type {any} */ x) => [x.line, x.kind]),
    [
      [3, 'device'],
      [3, 'store-address'],
    ],
  );
  assert.ok(!allText(r.result).includes(DEVICE));
  assert.ok(!allText(r.result).includes('sample-store'));
  writeFileSync(body, '## Summary\n\nPushed from a device to the store repository.\n');
  const ok = await c.hitld(['publish', 'check', '--file', body], { env });
  assert.equal(ok.exit, 0, JSON.stringify(ok.result));
  const text = await c.hitld(['publish', 'check', '--text', `on ${DEVICE}`]);
  assert.equal(text.result.refused[0].where, 'text');
  // An executor may check what it writes.
  const x = await c.hitld(['publish', 'check', '--file', body], {
    env: { HITLD_ROLE: 'executor' },
  });
  assert.equal(x.exit, 0);
  assert.equal((await c.hitld(['publish', 'check'])).result.error, 'usage');
});

test('store remote set puts the address and the repository names on the list', async () => {
  const c = makeConsumer();
  const r = await c.hitld(['store', 'remote', 'set', ADDRESS]);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.deepEqual(
    r.result.private_terms.map((/** @type {any} */ t) => [t.kind, t.added]),
    [
      ['store-address', true],
      ['repository', true],
      ['repository', true],
    ],
  );
  const list = await c.hitld(['private', 'list', '--show']);
  assert.deepEqual(
    list.result.terms.map((/** @type {any} */ t) => t.term),
    [ADDRESS, 'example-owner/sample-store', 'sample-store'],
  );
});

/** git commit with the consumer's environment, so its hooks read its private store. */
const commit = (/** @type {ReturnType<typeof makeConsumer>} */ c, /** @type {string[]} */ args) =>
  spawnSync('git', ['commit', '-q', ...args], {
    cwd: c.root,
    encoding: 'utf8',
    env: { ...process.env, ...c.env },
  });

test('the hooks install writes refuse a staged file and a commit message that hold a private term', async () => {
  const c = makeConsumer();
  const installed = await c.hitld(['install', '--marketplace', CHECKOUT]);
  assert.equal(installed.result.done.message_guard, 'installed');
  const hook = readFileSync(join(c.root, '.git', 'hooks', 'commit-msg'), 'utf8');
  assert.ok(
    hook.includes('const ARGS = ["check","commit-message"].concat(process.argv.slice(2));'),
  );
  assert.match(hook, /exec node - "\$@" <<'HITLD_GUARD'\n/);
  assert.equal((await c.hitld(['install'])).result.done.message_guard, 'unchanged');
  git(c.root, 'add', '-A');
  assert.equal(commit(c, ['-m', 'install']).status, 0);
  await c.hitld(['private', 'add', DEVICE, '--kind', 'device']);

  put(c.root, { 'docs/setup.md': `# Setup\n\nSync from ${DEVICE}.\n` });
  git(c.root, 'add', '-A');
  const staged = commit(c, ['-m', 'docs']);
  assert.notEqual(staged.status, 0);
  const out = staged.stdout + staged.stderr;
  assert.match(out, /docs\/setup\.md: line 3: holds a private device/);
  assert.ok(!out.includes(DEVICE), 'the hook never prints the term');

  put(c.root, { 'docs/setup.md': '# Setup\n\nSync from a device.\n' });
  git(c.root, 'add', '-A');
  const message = commit(c, ['-m', `docs: sync from ${DEVICE}`]);
  assert.notEqual(message.status, 0);
  assert.match(message.stdout + message.stderr, /holds a private device/);
  assert.ok(!(message.stdout + message.stderr).includes(DEVICE));
  assert.equal(commit(c, ['-m', 'docs: sync from a device']).status, 0);

  // The whole tree, as hitld work check sees it.
  put(c.root, { 'notes/n.md': `${DEVICE}\n` });
  const check = await c.hitld(['work', 'check']);
  assert.equal(check.result.ok, false);
  assert.ok(
    check.result.problems.some((/** @type {string} */ p) => p.startsWith('notes/n.md: line 1')),
  );
  const tree = await c.hitld(['check', 'classification']);
  assert.equal(tree.result.ok, false);
  assert.ok(!allText(tree.result).includes(DEVICE));
});

test('a damaged list stops the commit: the hooks fail closed', async () => {
  const c = makeConsumer();
  const store = openStore(privateStorePath('orch-fixture', { env: c.env }));
  store.append(TERMS_KEY, 'not json\n');
  const r = await c.hitld(['check', 'classification', '--staged']);
  assert.equal(r.result.error, 'private-list-invalid');
  const msg = join(c.base, 'msg');
  writeFileSync(msg, 'subject\n');
  assert.equal(
    (await c.hitld(['check', 'commit-message', msg])).result.error,
    'private-list-invalid',
  );
});

test('the merge refuses a commit whose file or message holds a private term, past --no-verify', async () => {
  const c = makeConsumer();
  const before = git(c.root, 'rev-parse', 'main');
  const terms = compileTerms([{ term: DEVICE, kind: 'device', id: 'PT-1' }]);
  git(c.root, 'switch', '-q', '-c', 'hitld/W-1-file');
  put(c.root, { 'src/a.txt': `built on ${DEVICE}\n` });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '--no-verify', '-m', 'add a file');
  git(c.root, 'switch', '-q', '-c', 'hitld/W-2-message', 'main');
  put(c.root, { 'src/b.txt': 'built on a device\n' });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '--no-verify', '-m', `add b, built on ${DEVICE}`);
  git(c.root, 'switch', '-q', 'main');

  const staged = checkStaged(c.root, { ...STRICT, terms });
  assert.equal(staged.refused.length, 0);
  put(c.root, { [`notes/${DEVICE}.md`]: 'notes\n' });
  git(c.root, 'add', '-A');
  assert.match(
    checkStaged(c.root, { ...STRICT, terms }).refused[0].message,
    /^its path holds a private device/,
  );
  git(c.root, 'reset', '-q');
  git(c.root, 'clean', '-fdq');
  const files = checkCommits(c.root, 'main', 'hitld/W-1-file', { ...STRICT, terms });
  assert.deepEqual(
    files.refused.map((r) => [r.path, r.rule, r.line, r.kind, r.term_id]),
    [['src/a.txt', 'private-term', 1, 'device', 'PT-1']],
  );
  const message = checkCommits(c.root, 'main', 'hitld/W-2-message', { ...STRICT, terms });
  assert.equal(message.refused[0].rule, 'private-term');
  assert.match(message.refused[0].path, /^commit [0-9a-f]{12} message$/);

  const settings = {
    mainBranch: 'main',
    batchMax: 4,
    fastChecks: [],
    fullSuite: ["node --test 'test/*.test.js'"],
    generated: [],
    flakeReruns: 0,
    classification: { ...STRICT, terms },
  };
  const q = await runMergeQueue({
    repoRoot: c.root,
    entries: [
      { item: 'W-1', branch: 'hitld/W-1-file' },
      { item: 'W-2', branch: 'hitld/W-2-message' },
    ],
    settings,
  });
  assert.deepEqual(
    q.rejected.map((x) => [x.item, x.reason, x.files]),
    [
      ['W-1', 'classification', ['src/a.txt']],
      ['W-2', 'classification', []],
    ],
  );
  assert.ok(!allText(q.rejected).includes(DEVICE));
  assert.equal(git(c.root, 'rev-parse', 'main'), before);
});

// --- CI: what needs no list ----------------------------------------------------------------

test("CI refuses a committed store address, a device list, and a person's email address", () => {
  const c = makeConsumer();
  const base = git(c.root, 'rev-parse', 'HEAD');
  const policy = JSON.parse(readFileSync(join(c.root, '.human-in-the-lead/policy.json'), 'utf8'));
  put(c.root, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      ...policy,
      store: { remote: { url: ADDRESS } },
    }),
    '.human-in-the-lead/store-devices.json': '{}\n',
    'docs/contact.md': `Write to ${PERSON} or noreply@example.com.\n`,
  });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '--no-verify', '-m', `contact\n\nAsked by ${BOSS}`);
  const r = checkPublicRange({ cwd: c.root, from: base, to: 'HEAD' });
  assert.deepEqual(r.findings.map((f) => [f.where, f.rule, f.line]).sort(), [
    ['.human-in-the-lead/policy.json', 'store-address', null],
    ['.human-in-the-lead/store-devices.json', 'store-devices', null],
    ['commit message', 'email', 3],
    ['docs/contact.md', 'email', 1],
  ]);
  const report = formatPublicReport(r);
  for (const secret of [PERSON, BOSS, 'sample-store']) {
    assert.ok(!report.includes(secret), secret);
  }
  const clean = checkPublicRange({ cwd: c.root, from: 'HEAD~1', to: 'HEAD~1' });
  assert.equal(clean.findings.length, 0);
  // With no base (a new branch), the last commit and its tree.
  assert.equal(checkPublicRange({ cwd: c.root, to: 'HEAD' }).commits, 1);
});
