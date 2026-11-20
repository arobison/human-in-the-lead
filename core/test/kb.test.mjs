// The knowledge-base tool (HITLD-55, design part 8.5): `hitld kb search`, `index`, `stale`, `links`
// and `check`, on a fixture knowledge base with one defect of each kind
// (core/test/fixtures/kb/README.md), and the check at merge in both runners.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../lib/cli/main.mjs';
import {
  budgetsOf,
  buildDecisions,
  checkKnowledgeBase,
  expandTerm,
  GENERATED_MARK,
  loadKnowledgeBase,
  parseGlossary,
} from '../lib/kb/kb.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { policyDefaults } from '../lib/policy/policy.mjs';
import { tempDir } from './helpers/tmp.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/kb/', import.meta.url));
const NOW = '2026-11-20T12:00:00Z';
const ID = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...ID },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/** @param {string} root @param {Record<string, string>} files */
function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** @param {string} root */
const commitAll = (root, /** @type {string} */ message) => {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--no-verify', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
};

const SECRET = `---\nsummary: The plan for the next database vendor.\nareas: [db]\nchecked: 2026-11-15\nclassification: confidential\n---\n\n# Vendor plan\n`;

/**
 * The fixture in a fresh repository: committed (BASE), then `checked_at: BASE` set to that commit
 * and a file under src/cache/ changed in a second commit. The confidential note is added only to
 * the working tree.
 */
function fixture() {
  const root = realpathSync(tempDir('hitld-kb-'));
  cpSync(FIXTURE, root, { recursive: true });
  renameSync(join(root, 'dot-hitld'), join(root, '.human-in-the-lead'));
  git(root, 'init', '-q', '-b', 'main');
  const base = commitAll(root, 'base');
  for (const note of ['kb/areas/http/cache.md', 'kb/areas/http/client.md']) {
    const file = join(root, note);
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('checked_at: BASE', `checked_at: ${base}`),
    );
  }
  put(root, { 'src/cache/store.js': 'export const store = new Map(); // keyed by URL\n' });
  const head = commitAll(root, 'checked_at set; the cache changed');
  put(root, { 'kb/areas/db/secret-plan.md': SECRET });
  /** @param {string[]} argv */
  const hitld = async (argv) => {
    let out = '';
    const code = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: root,
      env: { PATH: process.env.PATH },
    });
    return { code, result: /** @type {Record<string, any>} */ (JSON.parse(out)) };
  };
  return { root, base, head, hitld };
}

/** @param {{ kind: string, path: string }[]} problems */
const kinds = (problems) => problems.map((p) => `${p.kind} ${p.path}`).sort();

test('kb check finds one defect of each kind, and only those', async () => {
  const f = fixture();
  const { code, result } = await f.hitld(['kb', 'check', '--now', NOW]);
  assert.equal(code, 1, 'errors fail the check');
  assert.equal(result.ok, false);
  assert.deepEqual(kinds(result.errors), [
    'broken-link kb/playbooks/release.md',
    'front-matter kb/areas/db/bad-front-matter.md',
    'size kb/areas/db/too-long.md',
    'superseded-link kb/areas/http/client.md',
  ]);
  assert.match(
    result.errors.find((/** @type {any} */ e) => e.kind === 'front-matter').message,
    /owners/,
  );
  assert.match(
    result.errors.find((/** @type {any} */ e) => e.kind === 'superseded-link').message,
    /old-cache\.md is superseded by kb\/areas\/http\/cache\.md/,
  );
  assert.match(
    result.errors.find((/** @type {any} */ e) => e.kind === 'broken-link').message,
    /missing-checklist\.md#steps: no such file/,
    'the anchor is not part of the file; a link inside code is not a link',
  );
  assert.deepEqual(kinds(result.warnings), [
    'decisions kb/decisions.md',
    'index kb/index.md',
    'stale kb/areas/http/cache.md',
    'stale kb/areas/http/lost.md',
    'stale kb/conventions/naming.md',
  ]);
  assert.equal(result.stale, 3);
});

test('kb stale: a changed source, an unreachable checked_at, and an old unsourced note', async () => {
  const f = fixture();
  const { code, result } = await f.hitld(['kb', 'stale', '--now', NOW]);
  assert.equal(code, 0);
  assert.deepEqual(
    result.stale.map((/** @type {any} */ s) => [s.path, s.reason]),
    [
      ['kb/areas/http/cache.md', 'changed'],
      ['kb/areas/http/lost.md', 'unreachable'],
      ['kb/conventions/naming.md', 'old'],
    ],
  );
  assert.deepEqual(result.stale[0].changed, ['src/cache/store.js']);
  assert.match(result.stale[0].message, new RegExp(`stale since ${f.base}`));
  assert.ok(
    !result.stale.some((/** @type {any} */ s) => s.path === 'kb/areas/http/client.md'),
    'a note whose sources did not change is fresh',
  );
  assert.ok(
    !result.stale.some((/** @type {any} */ s) => s.path === 'kb/areas/http/old-cache.md'),
    'a superseded note is not listed',
  );

  // A checked_at that exists but is not on HEAD's history (an unmerged branch) is not reachable.
  git(f.root, 'switch', '-q', '-c', 'side', f.base);
  put(f.root, { 'side.txt': 'x\n' });
  const side = commitAll(f.root, 'side');
  git(f.root, 'switch', '-q', 'main');
  const file = join(f.root, 'kb/areas/http/client.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace(f.base, side));
  const again = await f.hitld(['kb', 'stale', '--now', NOW]);
  assert.deepEqual(
    again.result.stale.find((/** @type {any} */ s) => s.path === 'kb/areas/http/client.md')?.reason,
    'unreachable',
  );

  // With kb.max_age_unsourced 0, an unsourced note never goes stale by age.
  const kb = loadKnowledgeBase(f.root);
  const off = checkKnowledgeBase(
    kb,
    { ...budgetsOf(null), maxAgeUnsourced: 0 },
    { now: Date.parse(NOW) },
  );
  assert.ok(!off.warnings.some((w) => w.path === 'kb/conventions/naming.md'));
});

test('kb links reports the broken link and the link to a superseded note', async () => {
  const f = fixture();
  const { code, result } = await f.hitld(['kb', 'links']);
  assert.equal(code, 1);
  assert.deepEqual(kinds(result.problems), [
    'broken-link kb/playbooks/release.md',
    'superseded-link kb/areas/http/client.md',
  ]);
});

test('kb search expands terms through the glossary, ranks by matched terms, and narrows by area and tag', async () => {
  const f = fixture();
  const memo = await f.hitld(['kb', 'search', 'memoize']);
  assert.equal(memo.code, 0);
  assert.deepEqual(memo.result.expanded.memoize, ['cache', 'memo', 'response store']);
  assert.equal(memo.result.results[0].path, 'kb/areas/http/cache.md');
  assert.ok(
    !memo.result.results.some((/** @type {any} */ r) => r.path === 'kb/areas/http/old-cache.md'),
    'a superseded note is not a result',
  );

  const two = await f.hitld(['kb', 'search', 'cache invalidation']);
  assert.equal(two.result.results[0].path, 'kb/areas/http/cache.md');
  assert.deepEqual(two.result.results[0].matched, ['cache', 'invalidation']);

  const area = await f.hitld(['kb', 'search', 'cache', '--area', 'release']);
  assert.deepEqual(
    area.result.results.map((/** @type {any} */ r) => r.path),
    ['kb/playbooks/release.md'],
  );
  const tag = await f.hitld(['kb', 'search', 'requests', '--tag', 'client']);
  assert.deepEqual(
    tag.result.results.map((/** @type {any} */ r) => r.path),
    ['kb/areas/http/client.md'],
  );
  const none = await f.hitld(['kb', 'search', 'zebra']);
  assert.equal(none.result.count, 0);
});

test('kb index splits the index by area above kb.index_tokens_max, leaves out superseded and non-public notes, and writes decisions.md', async () => {
  const f = fixture();
  const { code, result } = await f.hitld(['kb', 'index']);
  assert.equal(code, 0);
  assert.equal(result.split, true);
  assert.ok(result.tokens > 150);
  assert.deepEqual(result.written.sort(), [
    'kb/areas/conventions/index.md',
    'kb/areas/db/index.md',
    'kb/areas/http/index.md',
    'kb/areas/release/index.md',
    'kb/decisions.md',
    'kb/index.md',
  ]);
  const top = readFileSync(join(f.root, 'kb/index.md'), 'utf8');
  assert.ok(top.includes(GENERATED_MARK));
  assert.match(top, /- \[glossary\.md\]\(glossary\.md\): Project terms/);
  assert.match(top, /- \[http\]\(areas\/http\/index\.md\): 3 note\(s\)/);
  const http = readFileSync(join(f.root, 'kb/areas/http/index.md'), 'utf8');
  assert.match(http, /- \[areas\/http\/cache\.md\]\(cache\.md\): How the HTTP client caches/);
  assert.ok(!http.includes('old-cache.md'), 'a superseded note is left out');
  const db = readFileSync(join(f.root, 'kb/areas/db/index.md'), 'utf8');
  assert.ok(!db.includes('secret-plan.md'), 'a confidential note is never in the public index');
  assert.match(readFileSync(join(f.root, 'kb/decisions.md'), 'utf8'), /None answered yet\./);

  // Current now: the index warning is gone, and a second run writes nothing.
  const checked = await f.hitld(['kb', 'check', '--now', NOW]);
  assert.ok(!checked.result.warnings.some((/** @type {any} */ w) => w.kind === 'index'));
  assert.ok(!checked.result.warnings.some((/** @type {any} */ w) => w.kind === 'decisions'));
  const again = await f.hitld(['kb', 'index']);
  assert.deepEqual(again.result.written, []);

  // Under the budget again, the per-area indexes it generated are removed.
  const policy = join(f.root, '.human-in-the-lead/policy.json');
  const p = JSON.parse(readFileSync(policy, 'utf8'));
  p.kb.index_tokens_max = 100000;
  writeFileSync(policy, JSON.stringify(p));
  const whole = await f.hitld(['kb', 'index']);
  assert.equal(whole.result.split, false);
  assert.deepEqual(whole.result.written, ['kb/index.md']);
  assert.equal(whole.result.removed.length, 4);
  assert.equal(existsSync(join(f.root, 'kb/areas/http/index.md')), false);
  assert.match(
    readFileSync(join(f.root, 'kb/index.md'), 'utf8'),
    /## http\n\n- \[areas\/http\/cache\.md\]\(areas\/http\/cache\.md\)/,
  );
});

test('decisions.md lists answered decisions and active precedents in number order', () => {
  const text = buildDecisions(
    [
      {
        id: 'W-12',
        title: 'Which cache',
        answer: 'B. The response store',
        answered_at: '2026-11-02T10:00:00Z',
      },
      { id: 'W-3', title: 'Which client', answer: 'A. Fetch' },
    ],
    [{ id: 'P-1', rule: 'Small notes,\n one topic each' }],
  );
  assert.match(
    text,
    /- W-3: Which client\. Answer: A\. Fetch\n- W-12 \(2026-11-02\): Which cache\. Answer: B\. The response store/,
  );
  assert.match(text, /- P-1: Small notes, one topic each/);
});

test('the glossary: each term with its synonyms; links and remarks are not synonyms', () => {
  const g = parseGlossary(
    '# Glossary\n\n- **cache**: memo, memoize (see [x](a.md))\n- `item`: work item; ticket\nA line that is not a list.\n- no colon here\n',
  );
  assert.deepEqual(g, [
    ['cache', 'memo', 'memoize'],
    ['item', 'work item', 'ticket'],
  ]);
  assert.deepEqual(expandTerm('Ticket', g), ['ticket', 'item', 'work item']);
  assert.deepEqual(expandTerm('other', g), ['other']);
});

test('a note without front matter, or with a symbolic link in kb/, is an error; a repository without kb/ passes', async () => {
  const root = realpathSync(tempDir('hitld-kb-plain-'));
  git(root, 'init', '-q', '-b', 'main');
  const budgets = budgetsOf(policyDefaults());
  assert.deepEqual(checkKnowledgeBase(loadKnowledgeBase(root), budgets).errors, []);
  put(root, { 'kb/plain.md': '# No front matter\n', 'outside.md': 'x\n' });
  execFileSync('ln', ['-s', '../outside.md', join(root, 'kb/link.md')]);
  assert.deepEqual(kinds(checkKnowledgeBase(loadKnowledgeBase(root), budgets).errors), [
    'front-matter kb/plain.md',
    'unreadable kb/link.md',
  ]);
});

test('at merge: a branch whose notes fail kb check goes back; stale notes alone do not refuse it', async () => {
  const f = fixture();
  // Main without the defects: drop the defective notes and the confidential one.
  for (const p of [
    'kb/playbooks/release.md',
    'kb/areas/db/bad-front-matter.md',
    'kb/areas/db/too-long.md',
    'kb/areas/db/secret-plan.md',
  ]) {
    execFileSync('rm', [join(f.root, p)]);
  }
  const file = join(f.root, 'kb/areas/http/client.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('(old-cache.md)', '(cache.md)'));
  const main = commitAll(f.root, 'a clean knowledge base, with stale notes');
  const policy = policyDefaults();
  /** @param {string} dir */
  const kbCheck = (dir) =>
    checkKnowledgeBase(loadKnowledgeBase(dir), budgetsOf(policy)).errors.map(
      (x) => `${x.path} ${x.message}`,
    );
  assert.deepEqual(kbCheck(f.root), [], 'stale notes are warnings, not errors');

  git(f.root, 'switch', '-q', '-c', 'hitld/KB-1');
  put(f.root, {
    'kb/areas/http/new.md': '---\nsummary: A note.\nareas: [http]\n---\n\nSee [gone](gone.md).\n',
  });
  commitAll(f.root, 'KB-1: a note with a broken link');
  git(f.root, 'switch', '-q', '-c', 'hitld/KB-2', 'main');
  put(f.root, {
    'kb/areas/http/fine.md': '---\nsummary: Another note.\nareas: [http]\n---\n\nFine.\n',
  });
  commitAll(f.root, 'KB-2: a clean note');
  git(f.root, 'switch', '-q', 'main');

  const result = await runMergeQueue({
    repoRoot: f.root,
    entries: [
      { item: 'KB-1', branch: 'hitld/KB-1', dispatch: 'D-1' },
      { item: 'KB-2', branch: 'hitld/KB-2' },
    ],
    settings: {
      mainBranch: 'main',
      batchMax: 4,
      fastChecks: [],
      fullSuite: ['true'],
      generated: [],
      flakeReruns: 0,
      kbCheck,
    },
  });
  assert.deepEqual(
    result.rejected.map((x) => [x.item, x.reason, x.output]),
    [['KB-1', 'knowledge_base', 'kb/areas/http/new.md gone.md: no such file']],
  );
  assert.match(String(result.rejected[0].message), /fails hitld kb check/);
  assert.deepEqual(
    result.merged.map((/** @type {any} */ m) => m.item),
    ['KB-2'],
  );
  assert.notEqual(git(f.root, 'rev-parse', 'main'), main, 'main moved to the clean branch');
});
