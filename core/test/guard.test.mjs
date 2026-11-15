// The commit guard (design part 10.3, rule 3): one classification rule, in the pre-commit hook
// hitld install writes, at merge in either mode, and in hitld work check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  READ_LIMIT,
  STRICT,
  checkCommits,
  checkStaged,
  frontMatterClassification,
  judge,
  judgeContent,
  parseRaw,
} from '../lib/guard/classification.mjs';
import { HOOK_MARK } from '../lib/install/install.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { chooseNamed } from '../lib/merge/owner.mjs';
import { git, item, makeConsumer, put } from './orchestrator-fixture.mjs';

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

// --- hitld install writes the hook -----------------------------------------------------------

test('install writes the pre-commit hook; it refuses a confidential commit, naming file and rule', async () => {
  const c = makeConsumer();
  const r = await c.hitld(['install', '--marketplace', CHECKOUT]);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.equal(r.result.done.commit_guard, 'installed');
  const hook = join(c.root, '.git', 'hooks', 'pre-commit');
  const text = readFileSync(hook, 'utf8');
  assert.ok(text.includes(HOOK_MARK));
  assert.ok(text.includes(join(CHECKOUT, 'core/bin/hitld.mjs')));
  assert.match(text, /exec node "\$HITLD" check classification --staged\n$/);
  assert.equal(statSync(hook).mode & 0o111, 0o111);
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
  fullSuite: ["node --test 'test/*.test.js'"],
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
