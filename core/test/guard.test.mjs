// The commit guard (design part 10.3, rule 3): one classification rule, in the pre-commit hook
// hitld install writes, at merge in either mode, and in hitld work check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  READ_LIMIT,
  STRICT,
  checkCommits,
  checkStaged,
  frontMatterClassification,
  judge,
  judgeContent,
  judgeMessage,
  parseRaw,
} from '../lib/guard/classification.mjs';
import { addedLines, checkPublicRange, commitsIn } from '../lib/guard/public-check.mjs';
import { compileTerms, findEmails } from '../lib/guard/private-terms.mjs';
import { judgePlacement } from '../lib/guard/store-placement.mjs';
import { HOOK_MARK } from '../lib/install/install.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { chooseNamed } from '../lib/merge/owner.mjs';
import { git, item, makeConsumer, put } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));
const CONFIDENTIAL = '---\ntitle: Plan\nclassification: confidential\n---\n\nPrivate.\n';
const rules = (/** @type {Partial<typeof STRICT>} */ over = {}) => ({ ...STRICT, ...over });
/** @param {string} path @param {string} text */
const judgeText = (path, text, r = rules()) => judgeContent(path, Buffer.from(text), false, r);

// --- The rule ------------------------------------------------------------------------------

test('front matter above the ceiling is refused, naming the file and the rule', () => {
  const r = judgeText('notes/plan.md', CONFIDENTIAL);
  assert.deepEqual(r, {
    path: 'notes/plan.md',
    rule: 'front-matter',
    classification: 'confidential',
    message:
      'classification "confidential" in its front matter is above the repository\'s ceiling "public"',
  });
  assert.equal(judgeText('a.md', CONFIDENTIAL, rules({ ceiling: 'confidential' })), null);
  assert.equal(judgeText('a.md', '---\nclassification: public\n---\n'), null);
});

test('front matter is read as written: CRLF, quotes, comments, a BOM; nested and body keys do not count', () => {
  assert.equal(
    judgeText('a.md', '---\r\nclassification: "secret"\r\n---\r\n')?.classification,
    'secret',
  );
  assert.equal(
    judgeText('a.md', "﻿---\nclassification: 'internal' # why\n---\n")?.rule,
    'front-matter',
  );
  assert.equal(judgeText('a.md', '---\nmeta:\n  classification: secret\n---\n'), null);
  assert.equal(judgeText('a.md', '# Title\n\nclassification: secret\n'), null);
  assert.equal(
    judgeText('a.md', '---\nclassification: secret\n'),
    null,
    'never closed: not front matter',
  );
  // Two values: the higher one counts.
  assert.equal(
    judgeText('a.md', '---\nclassification: public\nclassification: confidential\n---\n')
      ?.classification,
    'confidential',
  );
});

test('an unknown level is refused, and so is front matter that will not close in the read', () => {
  assert.match(String(judgeText('a.md', '---\nclassification: Top\n---\n')?.message), /not one of/);
  assert.match(String(judgeText('a.md', '---\nclassification:\n---\n')?.message), /not one of/);
  const long = `---\ntitle: x\n${'pad: y\n'.repeat(10)}`;
  const r = judgeContent('big.md', Buffer.from(long), true, rules());
  assert.equal(r?.rule, 'unreadable');
  assert.ok('error' in frontMatterClassification(long, true));
  assert.equal(READ_LIMIT, 1024 * 1024);
});

test('a file with no classification takes the project default', () => {
  const r = judgeText(
    'src/a.js',
    'export const a = 1;\n',
    rules({ defaultClassification: 'internal' }),
  );
  assert.equal(r?.rule, 'project-default');
  assert.match(
    String(r?.message),
    /project default "internal" \(tracker\.json default_classification\)/,
  );
  assert.equal(
    judgeText('src/a.js', 'x\n', rules({ defaultClassification: 'internal', ceiling: 'internal' })),
    null,
  );
});

test('a path listed as private in policy is never public', () => {
  const r = judge('research/notes/a.md', [], rules({ privatePaths: ['research/**'] }));
  assert.equal(r?.rule, 'private-path');
  assert.match(String(r?.message), /"research\/\*\*" in policy project\.private_paths/);
  assert.equal(
    judge('research/a.md', [], rules({ privatePaths: ['research/**'], ceiling: 'internal' })),
    null,
  );
  assert.equal(judge('src/a.md', [], rules({ privatePaths: ['research/**'] })), null);
});

test('raw diff output: added, changed and type-changed blobs; deletions and submodules skipped', () => {
  const sha = 'a'.repeat(40);
  const zero = '0'.repeat(40);
  const raw = [
    `:000000 100644 ${zero} ${sha} A`,
    'new.md',
    `:100644 100644 ${sha} ${sha} M`,
    'changed.md',
    `:100644 000000 ${sha} ${zero} D`,
    'gone.md',
    `:000000 160000 ${zero} ${sha} A`,
    'vendor/sub',
    '',
  ].join('\0');
  assert.deepEqual(
    parseRaw(raw).map((b) => b.path),
    ['new.md', 'changed.md'],
  );
});

// --- Staged files and commits ----------------------------------------------------------------

test('staged files are judged as the index has them, not the working tree', () => {
  const c = makeConsumer();
  put(c.root, { 'notes/plan.md': CONFIDENTIAL });
  git(c.root, 'add', 'notes/plan.md');
  writeFileSync(join(c.root, 'notes/plan.md'), 'now public\n');
  const r = checkStaged(c.root, rules());
  assert.deepEqual(
    r.refused.map((x) => x.path),
    ['notes/plan.md'],
  );
});

test('a file one commit adds and a later one removes is still refused: history would hold it', () => {
  const c = makeConsumer();
  const base = git(c.root, 'rev-parse', 'HEAD');
  put(c.root, { 'notes/plan.md': CONFIDENTIAL });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '--no-verify', '-m', 'add');
  git(c.root, 'rm', '-q', 'notes/plan.md');
  git(c.root, 'commit', '-q', '--no-verify', '-m', 'remove');
  const r = checkCommits(c.root, base, 'HEAD', rules());
  assert.deepEqual(
    r.refused.map((x) => x.path),
    ['notes/plan.md'],
  );
  assert.equal(checkCommits(c.root, 'HEAD~1', 'HEAD', rules()).refused.length, 0);
});

test("the store placement rule: a policy.json that names the store's address is refused at any ceiling", () => {
  const address = JSON.stringify({
    schema_version: 1,
    project: { id: 'app', key: 'APP' },
    store: { remote: { url: 'https://github.com/example-owner/sample-app-store.git' } },
  });
  const open = rules({ ceiling: 'secret' });
  for (const path of ['.human-in-the-lead/policy.json', 'sub/.human-in-the-lead/policy.json']) {
    const r = judgeText(path, address, open);
    assert.equal(r?.rule, 'store-address', path);
    assert.match(String(r?.message), /HITLD_STORE_REMOTE/);
    assert.doesNotMatch(String(r?.message), /sample-app-store/, 'the address is never repeated');
  }
  const required = JSON.stringify({ schema_version: 1, store: { remote: { required: true } } });
  assert.equal(judgeText('.human-in-the-lead/policy.json', required, open), null);
  assert.equal(judgeText('docs/policy.json', address, open), null, 'only the policy file');
  assert.equal(judgeText('.human-in-the-lead/policy.json', '{', open), null);

  // Staged, and in a commit a branch brings.
  const c = makeConsumer();
  const base = git(c.root, 'rev-parse', 'HEAD');
  put(c.root, { '.human-in-the-lead/policy.json': address });
  git(c.root, 'add', '.human-in-the-lead/policy.json');
  assert.deepEqual(
    checkStaged(c.root, open).refused.map((x) => [x.path, x.rule]),
    [['.human-in-the-lead/policy.json', 'store-address']],
  );
  git(c.root, 'commit', '-q', '--no-verify', '-m', 'name the store');
  assert.equal(checkCommits(c.root, base, 'HEAD', open).refused[0]?.rule, 'store-address');
});

// --- hitld install writes the hook -----------------------------------------------------------

test('install writes the pre-commit hook; it refuses a confidential commit, naming file and rule', async () => {
  const c = makeConsumer();
  const r = await c.hitld(['install', '--marketplace', CHECKOUT]);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.equal(r.result.done.commit_guard, 'installed');
  const hook = join(c.root, '.git', 'hooks', 'pre-commit');
  const text = readFileSync(hook, 'utf8');
  assert.ok(text.includes(HOOK_MARK));
  assert.ok(text.includes(JSON.stringify(join(CHECKOUT, 'core/bin/hitld.mjs'))));
  assert.ok(text.includes('const ARGS = ["check","classification","--staged"]'));
  // Windows has no executable bit to set or read (git there runs a hook by its #! line).
  if (process.platform !== 'win32') assert.equal(statSync(hook).mode & 0o111, 0o111);
  assert.equal((await c.hitld(['install'])).result.done.commit_guard, 'unchanged');

  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '-m', 'install');
  put(c.root, { 'notes/plan.md': CONFIDENTIAL });
  git(c.root, 'add', '-A');
  const commit = spawnSync('git', ['commit', '-q', '-m', 'add the plan'], {
    cwd: c.root,
    encoding: 'utf8',
  });
  assert.notEqual(commit.status, 0);
  const out = commit.stdout + commit.stderr;
  assert.match(
    out,
    /notes\/plan\.md: classification \\?"confidential\\?" in its front matter is above the repository's ceiling/,
  );
  // A public file commits.
  git(c.root, 'reset', '-q');
  put(c.root, { 'notes/plan.md': 'public notes\n' });
  git(c.root, 'add', '-A');
  assert.equal(spawnSync('git', ['commit', '-q', '-m', 'notes'], { cwd: c.root }).status, 0);
});

test('install leaves a pre-commit hook that is not its own, and a core.hooksPath, alone', async () => {
  const c = makeConsumer();
  const hook = join(c.root, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const r = await c.hitld(['install', '--marketplace', CHECKOUT]);
  assert.equal(r.exit, 0);
  assert.equal(r.result.done.commit_guard, 'not installed (a pre-commit hook exists)');
  assert.ok(
    r.result.warnings.some((/** @type {string} */ w) =>
      w.includes('check classification --staged'),
    ),
  );
  assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\nexit 0\n');

  const d = makeConsumer();
  git(d.root, 'config', 'core.hooksPath', '.husky');
  const h = await d.hitld(['install', '--marketplace', CHECKOUT]);
  assert.equal(h.result.done.commit_guard, 'not installed (core.hooksPath is set)');
  assert.equal(existsSync(join(d.root, '.husky', 'pre-commit')), false);
  assert.equal(existsSync(join(d.root, '.git', 'hooks', 'pre-commit')), false);
});

test('install refuses to run for an executor', async () => {
  const c = makeConsumer();
  for (const env of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-4' }]) {
    const r = await c.hitld(['install', '--marketplace', CHECKOUT], { env });
    assert.equal(r.exit, 1);
    assert.equal(r.result.error, 'not-permitted');
  }
  assert.equal(existsSync(join(c.root, '.git', 'hooks', 'pre-commit')), false);
});

// --- The merge refuses, whatever the hook did ------------------------------------------------

const SETTINGS = {
  mainBranch: 'main',
  batchMax: 4,
  fastChecks: [],
  fullSuite: ['node --test "test/*.test.js"'],
  generated: [],
  flakeReruns: 0,
};

test('a confidential file committed past the hook (--no-verify, or hitld claim) is refused at merge in both modes', async () => {
  const c = makeConsumer({
    files: {
      '.human-in-the-lead/tracker.json': JSON.stringify({
        schema_version: 1,
        optional_keys: ['touches', 'classification'],
      }),
    },
  });
  await c.hitld(['install', '--marketplace', CHECKOUT]);
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '-m', 'install');
  const before = git(c.root, 'rev-parse', 'main');

  // A plain --no-verify commit.
  git(c.root, 'switch', '-q', '-c', 'hitld/W-1-leak');
  put(c.root, { 'notes/plan.md': CONFIDENTIAL });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '--no-verify', '-m', 'skip the hook');
  // hitld's own claim commit uses --no-verify: an item raised to confidential rides on it.
  git(c.root, 'switch', '-q', '-c', 'hitld/W-2-close', 'main');
  put(c.root, {
    'work/items/W-2-another-thing.md': item({
      id: 'W-2',
      title: 'Another thing',
      kind: 'work',
      state: 'planned',
      priority: 'high',
      classification: 'confidential',
    }),
  });
  const claimed = await c.hitld(['work', 'claim', 'W-2', '--dispatch', 'D-9']);
  assert.equal(claimed.exit, 0, JSON.stringify(claimed.result));
  assert.match(
    git(c.root, 'show', 'HEAD:work/items/W-2-another-thing.md'),
    /classification: confidential/,
  );
  assert.equal(git(c.root, 'status', '--porcelain'), '');
  git(c.root, 'switch', '-q', 'main');

  const entries = [
    { item: 'W-1', branch: 'hitld/W-1-leak' },
    { item: 'W-2', branch: 'hitld/W-2-close' },
  ];
  const owner = await runMergeQueue({
    repoRoot: c.root,
    entries: chooseNamed(entries, ['hitld/W-1-leak']).chosen,
    settings: SETTINGS, // no classification given: the strictest rules apply
  });
  assert.deepEqual(
    owner.rejected.map((x) => [x.item, x.reason, x.files]),
    [['W-1', 'classification', ['notes/plan.md']]],
  );
  assert.match(String(owner.rejected[0].output), /notes\/plan\.md: classification "confidential"/);
  const queue = await runMergeQueue({
    repoRoot: c.root,
    entries,
    settings: { ...SETTINGS, classification: rules() },
  });
  assert.deepEqual(
    queue.rejected.map((x) => [x.item, x.reason]),
    [
      ['W-1', 'classification'],
      ['W-2', 'classification'],
    ],
  );
  assert.equal(git(c.root, 'rev-parse', 'main'), before);
});

test("the merge queue's own regenerate commit is checked too: a generator cannot put a leak on main", async () => {
  const c = makeConsumer({
    files: {
      'gen.mjs': `import { writeFileSync } from 'node:fs';\nwriteFileSync('leak.md', ${JSON.stringify(CONFIDENTIAL)});\n`,
    },
  });
  const before = git(c.root, 'rev-parse', 'main');
  git(c.root, 'switch', '-q', '-c', 'hitld/W-1-ok');
  put(c.root, { 'src/b.js': 'export const b = 2;\n' });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '-m', 'b');
  git(c.root, 'switch', '-q', 'main');
  const r = await runMergeQueue({
    repoRoot: c.root,
    entries: [{ item: 'W-1', branch: 'hitld/W-1-ok' }],
    settings: { ...SETTINGS, generated: [{ globs: ['leak.md'], regenerate: 'node gen.mjs' }] },
  });
  assert.equal(r.incident?.kind, 'classification');
  assert.match(String(r.incident?.output), /^leak\.md: /);
  assert.equal(git(c.root, 'rev-parse', 'main'), before);
});

// --- hitld work check over the whole tree ----------------------------------------------------

test('work check applies the same rule to every file in the tree, with private paths from policy', async () => {
  const c = makeConsumer({
    policy: { project: { id: 'orch-fixture', key: 'W', private_paths: ['research/**'] } },
  });
  // The fixture's items have no project; those problems are not this test's.
  const before = (await c.hitld(['work', 'check'])).result.problems;
  assert.equal((await c.hitld(['check', 'classification'])).exit, 0);
  put(c.root, { 'docs/plan.md': CONFIDENTIAL, 'research/a.txt': 'notes\n' });
  const r = await c.hitld(['work', 'check']);
  assert.equal(r.exit, 1);
  const added = [
    'docs/plan.md: classification "confidential" in its front matter is above the repository\'s ceiling "public"',
    'research/a.txt: its path matches "research/**" in policy project.private_paths, so it is not public, and the repository\'s ceiling is "public"',
  ];
  assert.deepEqual(r.result.problems, [...before, ...added]);
  const whole = await c.hitld(['check', 'classification']);
  assert.equal(whole.exit, 1);
  assert.deepEqual(whole.result.problems, added);
});

// --- Batched reads give what one process per commit and per file gave -------------------------

/**
 * A history with what the readers must get right: a root commit, a merge whose sides both change
 * files, a rename, a deletion, a mode change, a binary file, a file past the read limit with front
 * matter that does not close in it, a store address added then removed, and emails and a private
 * term in files and messages.
 */
function history() {
  // Built here, so this file holds no address the public check would flag.
  const PERSON = ['person', 'acme-corp.com'].join('@');
  const root = realpathSync(tempDir('hitld-guard-'));
  /** @param {...string} args */
  const g = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Agent',
        GIT_AUTHOR_EMAIL: 'agent@example.com',
        GIT_COMMITTER_NAME: 'Agent',
        GIT_COMMITTER_EMAIL: 'agent@example.com',
      },
    }).trim();
  /** @param {string} message @param {Record<string, string | Buffer | null>} files */
  const commit = (message, files) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) g('rm', '-q', '--', path);
      else {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
        g('add', '--', path);
      }
    }
    g('commit', '-q', '--allow-empty', '-m', message);
    return g('rev-parse', 'HEAD');
  };
  g('init', '-q', '-b', 'main');
  g('config', 'core.autocrlf', 'false');
  // An unrelated commit, so a range can take in the root commit.
  g('checkout', '-q', '--orphan', 'elsewhere');
  const elsewhere = commit('elsewhere', { 'x.txt': 'x\n' });
  g('checkout', '-q', '--orphan', 'main');
  g('rm', '-rq', '--cached', '.');
  rmSync(join(root, 'x.txt'));
  commit(`start\n\nWritten by ${PERSON} on the build-host-7 machine.`, {
    'docs/plan.md': CONFIDENTIAL,
    'docs/old.md': 'old\n',
    '.human-in-the-lead/policy.json': JSON.stringify({ store: { remote: { url: 'x' } } }),
  });
  g('checkout', '-q', '-b', 'side');
  commit('side', { 'side.md': `mail me at ${PERSON}\n`, 'docs/old.md': 'side\n' });
  g('checkout', '-q', 'main');
  commit('main side', { 'main.md': '---\nclassification: secret\n---\n' });
  g('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  g('mv', 'docs/old.md', 'docs/renamed.md');
  commit('rename', { 'docs/plan.md': null, 'bin.dat': Buffer.from([0, 1, 2, 0, 255]) });
  g('update-index', '--chmod=+x', 'main.md');
  commit('mode', {});
  commit('big', { 'big.md': `---\ntitle: big\n${'pad: y\n'.repeat(160 * 1024)}` });
  commit('no address', { '.human-in-the-lead/policy.json': '{}\n' });
  commit('empty', {});
  return { root, elsewhere, g };
}

/** checkCommits as it was, with one git process per commit and per file. @param {string} cwd @param {string} from @param {string} to @param {any} r */
function checkCommitsOneByOne(cwd, from, to, r) {
  /** @param {string[]} args */
  const g = (args) => execFileSync('git', args, { cwd, maxBuffer: 1 << 28 }).toString('utf8');
  const RAW = ['--raw', '-z', '--no-abbrev', '--no-renames', '--diff-filter=AMT'];
  const limit = r.terms?.length ? 64 * 1024 * 1024 : READ_LIMIT;
  const commits = g(['rev-list', '--reverse', `${from}..${to}`])
    .split('\n')
    .filter(Boolean);
  const blobs = [];
  const messages = [];
  for (const c of commits) {
    blobs.push(...parseRaw(g(['diff-tree', '-r', '-m', '--root', '--no-commit-id', ...RAW, c])));
    if (r.terms?.length) {
      const m = judgeMessage(c, g(['log', '-1', '--format=%B', c]), r);
      if (m) messages.push(m);
    }
  }
  const seen = new Set();
  const refused = [];
  for (const b of blobs) {
    if (seen.has(`${b.sha} ${b.path}`)) continue;
    seen.add(`${b.sha} ${b.path}`);
    const out = spawnSync('git', ['cat-file', 'blob', b.sha], { cwd, maxBuffer: limit });
    const truncated = /** @type {any} */ (out.error)?.code === 'ENOBUFS';
    const x = judgeContent(b.path, out.stdout, truncated, r);
    if (x) refused.push(x);
  }
  return { files: seen.size, refused: [...refused, ...messages] };
}

test('checkCommits in a fixed number of processes finds what one process per commit and file found', () => {
  const { root, elsewhere } = history();
  const terms = compileTerms([{ term: 'build-host-7', kind: 'device', id: 'PT-1' }]);
  for (const r of [rules(), rules({ ceiling: 'secret', terms })]) {
    for (const [from, to] of [
      [elsewhere, 'HEAD'],
      ['HEAD', 'HEAD'],
    ]) {
      const want = checkCommitsOneByOne(root, from, to, r);
      assert.deepEqual(checkCommits(root, from, to, r), want, `${from}..${to}`);
    }
  }
  const all = checkCommits(root, elsewhere, 'HEAD', rules({ terms }));
  // The case each part covers is there: a term in a message, a big file, a store address.
  assert.ok(all.refused.some((x) => x.commit && x.rule === 'private-term'));
  assert.ok(
    checkCommits(root, elsewhere, 'HEAD', rules()).refused.some(
      (x) => x.path === 'big.md' && x.rule === 'unreadable',
    ),
  );
  assert.ok(all.refused.some((x) => x.rule === 'store-address'));
});

/** checkPublicRange as it was, with several git processes per commit. @param {{ cwd: string, from?: string, to: string }} o */
function checkPublicOneByOne(o) {
  /** @param {string[]} args */
  const g = (args) => execFileSync('git', args, { cwd: o.cwd, encoding: 'utf8' });
  const EMAIL =
    "an email address that is not a noreply one; use a noreply address (a forge gives one) or a placeholder on example.com, and keep a person's own address out of the repository";
  /** @param {string} commit @param {string[]} paths */
  const placementIn = (commit, paths) =>
    paths.flatMap((path) => {
      if (!/(^|\/)\.human-in-the-lead\/(policy|store-devices)\.json$/.test(path)) return [];
      const shown = spawnSync('git', ['show', `${commit}:${path}`], {
        cwd: o.cwd,
        encoding: 'utf8',
      });
      if (shown.status !== 0) return [];
      const r = judgePlacement(path, shown.stdout);
      return r ? [{ commit, where: path, line: null, rule: r.rule, message: r.message }] : [];
    });
  const commits = commitsIn(o.cwd, o.from, o.to);
  /** @type {any[]} */
  const findings = [];
  const seen = new Set();
  /** @param {any} f */
  const add = (f) => {
    const key = `${f.commit}\0${f.where}\0${f.rule}\0${f.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };
  for (const c of commits) {
    const changed = g(['diff-tree', '-r', '--root', '--no-commit-id', '--name-only', c])
      .split('\n')
      .filter(Boolean);
    for (const f of placementIn(c, changed)) add(f);
    for (const a of addedLines(o.cwd, c)) {
      if (findEmails(a.text).length) {
        add({ commit: c, where: a.path, line: a.line, rule: 'email', message: EMAIL });
      }
    }
    for (const e of findEmails(g(['log', '-1', '--format=%B', c]))) {
      add({ commit: c, where: 'commit message', line: e.line, rule: 'email', message: EMAIL });
    }
  }
  const tree = g(['ls-tree', '-r', '--name-only', o.to]).split('\n').filter(Boolean);
  const head = g(['rev-parse', o.to]).trim();
  for (const f of placementIn(head, tree)) {
    if (!findings.some((x) => x.where === f.where && x.rule === f.rule)) add(f);
  }
  return { commits: commits.length, findings };
}

test('checkPublicRange in a fixed number of processes finds what several per commit found', () => {
  const { root, elsewhere, g } = history();
  const ranges = [
    { from: elsewhere, to: 'HEAD' },
    { from: 'HEAD~4', to: 'HEAD~1' },
    { to: 'HEAD~2' },
    { from: '0'.repeat(40), to: 'HEAD' },
    { from: 'HEAD', to: 'HEAD' },
  ];
  for (const range of ranges) {
    const o = { cwd: root, ...range };
    assert.deepEqual(checkPublicRange(o), checkPublicOneByOne(o), JSON.stringify(range));
  }
  const all = checkPublicRange({ cwd: root, from: elsewhere, to: 'HEAD' });
  assert.deepEqual([...new Set(all.findings.map((f) => `${f.where}: ${f.rule}`))].sort(), [
    '.human-in-the-lead/policy.json: store-address',
    'commit message: email',
    'side.md: email',
  ]);
  assert.equal(all.commits, Number(g('rev-list', '--count', '--no-merges', 'HEAD')));
});
