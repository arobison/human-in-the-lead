import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCommits, readCommits } from '../lib/dco/check.mjs';
import { git } from './tracker-fixture.mjs';

const ENTRY = fileURLToPath(new URL('../bin/dco-check.mjs', import.meta.url));

const ALICE = 'Alice Example <alice@example.org>';
const OWNER = 'Owen Owner <owen@example.org>';
const AGENT = 'Claude <noreply@anthropic.com>';

/** @returns {string} */
const makeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'hitld-dco-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'user.name', 'Merger');
  git(root, 'config', 'user.email', 'merger@example.org');
  return root;
};

/**
 * Commit a change with an exact message, by `author` ("Name <email>").
 * @param {string} root @param {string} message @param {string} author
 */
const commit = (root, message, author) => {
  writeFileSync(join(root, `f-${Math.random()}.txt`), 'x\n');
  git(root, 'add', '.');
  const [, name, email] = /^(.*) <(.*)>$/.exec(author) ?? [];
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
    },
  });
  return git(root, 'rev-parse', 'HEAD').trim();
};

/** The repository with a signed base commit, so `base..HEAD` is the branch under test. */
const withBase = () => {
  const root = makeRepo();
  const base = commit(root, `base\n\nSigned-off-by: ${OWNER}`, OWNER);
  return { root, base };
};

/** @param {string} root @param {string} from @param {'pr' | 'main'} mode */
const run = (root, from, mode) => checkCommits(readCommits(root, from, 'HEAD'), mode);

test('pr: all commits signed by their authors pass', () => {
  const { root, base } = withBase();
  commit(root, `one\n\nSigned-off-by: ${ALICE}`, ALICE);
  commit(root, `two\n\nSigned-off-by: ${ALICE}`, ALICE);
  const r = run(root, base, 'pr');
  assert.equal(r.checked, 2);
  assert.deepEqual(r.findings, []);
});

test('pr: one unsigned human commit fails with its SHA and the fix', () => {
  const { root, base } = withBase();
  commit(root, `one\n\nSigned-off-by: ${ALICE}`, ALICE);
  const bad = commit(root, 'two, forgot to sign', ALICE);
  const r = run(root, base, 'pr');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].sha, bad);
  assert.match(r.findings[0].fix, /git commit --amend -s/);
  assert.match(r.findings[0].fix, /git rebase --signoff/);
  const cli = spawnSync('node', [ENTRY, '--mode', 'pr', '--from', base, '--to', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 1);
  assert.ok(cli.stdout.includes(bad.slice(0, 12)));
});

test('pr: a sign-off by someone other than the author fails', () => {
  const { root, base } = withBase();
  commit(root, `one\n\nSigned-off-by: ${OWNER}`, ALICE);
  assert.equal(run(root, base, 'pr').findings.length, 1);
});

test('pr: an unsigned agent commit is accepted', () => {
  const { root, base } = withBase();
  commit(root, 'claim: X-1\n\nWork-Item: X-1\nDispatch: D-1', AGENT);
  commit(root, 'work\n\nWork-Item: X-1\nAgent-Role: executor\nAgent-Model: sonnet', AGENT);
  const r = run(root, base, 'pr');
  assert.equal(r.checked, 2);
  assert.deepEqual(r.findings, []);
});

test('pr: a merge commit is exempt, and the report says so', () => {
  const { root, base } = withBase();
  git(root, 'checkout', '-q', '-b', 'topic');
  commit(root, `topic work\n\nSigned-off-by: ${ALICE}`, ALICE);
  git(root, 'checkout', '-q', 'main');
  commit(root, `main moves\n\nSigned-off-by: ${OWNER}`, OWNER);
  git(root, 'checkout', '-q', 'topic');
  git(root, 'merge', '-q', '--no-ff', '--no-edit', 'main');
  const r = run(root, base, 'pr');
  assert.equal(r.exempt.length, 1);
  assert.deepEqual(r.findings, []);
  const cli = spawnSync('node', [ENTRY, '--mode', 'pr', '--from', base, '--to', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /Exempt: merge commits/);
});

test('main: a squash commit signed by its approver is accepted', () => {
  const { root, base } = withBase();
  commit(
    root,
    `HITLD-1: add thing (#4)\n\n* work\n\nWork-Item: X-1\nAgent-Role: executor\nCo-Authored-By: ${AGENT}\n\nSigned-off-by: ${OWNER}`,
    AGENT,
  );
  assert.deepEqual(run(root, base, 'main').findings, []);
});

test('main: a squash commit with only an agent sign-off is refused', () => {
  const { root, base } = withBase();
  const bad = commit(root, `HITLD-1: add thing (#4)\n\nSigned-off-by: ${AGENT}`, AGENT);
  const r = run(root, base, 'main');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].sha, bad);
  assert.match(r.findings[0].problem, /agent/);
  const unsigned = commit(root, 'no sign-off at all', AGENT);
  assert.equal(run(root, base, 'main').findings[1].sha, unsigned);
});

test('main: a merge commit is exempt', () => {
  const { root, base } = withBase();
  git(root, 'checkout', '-q', '-b', 'topic');
  commit(root, `topic work\n\nSigned-off-by: ${ALICE}`, ALICE);
  git(root, 'checkout', '-q', 'main');
  commit(root, `main moves\n\nSigned-off-by: ${OWNER}`, OWNER);
  git(root, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #1', 'topic');
  const r = run(root, base, 'main');
  assert.equal(r.exempt.length, 1);
  assert.deepEqual(r.findings, []);
});

test('main: only the pushed range is read, and a new branch reads only its tip', () => {
  const root = makeRepo();
  commit(root, 'first commit predates the DCO', ALICE);
  const before = git(root, 'rev-parse', 'HEAD').trim();
  commit(root, `signed\n\nSigned-off-by: ${OWNER}`, OWNER);
  assert.equal(readCommits(root, before, 'HEAD').length, 1);
  assert.deepEqual(run(root, before, 'main').findings, []);
  assert.equal(readCommits(root, '0'.repeat(40), 'HEAD').length, 1);
});
