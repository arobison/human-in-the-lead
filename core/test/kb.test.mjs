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
  buildIndex,
  checkKnowledgeBase,
  expandTerm,
  GENERATED_MARK,
  loadKnowledgeBase,
  mergeErrors,
  parseGlossary,
  safeLine,
  searchKnowledgeBase,
  writeGenerated,
} from '../lib/kb/kb.mjs';
import { fakeGitHub } from '../lib/merge/github.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, item, makeConsumer, report } from './orchestrator-fixture.mjs';
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
  const kbCheck = (dir) => mergeErrors(dir, policy, 'public');
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

/**
 * A repository with a kb/ and, when given, tracker files and tracker.json, committed.
 * @param {Record<string, string>} files
 */
function repoWith(files) {
  const root = realpathSync(tempDir('hitld-kb-repo-'));
  git(root, 'init', '-q', '-b', 'main');
  put(root, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'kb-repo', key: 'KB' },
    }),
    ...files,
  });
  commitAll(root, 'start');
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
  return { root, hitld };
}

/** @param {Record<string, string>} f */
const fm = (f, body = 'Body.\n') =>
  `---\n${Object.entries(f)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n${body}`;

test('decisions.md lists only public decisions and precedents; a confidential one never leaks (review 1)', async () => {
  const r = repoWith({
    'kb/note.md': fm({ summary: 'A note.' }),
    'work/items/KB-1-pick-a-cache.md': fm({
      id: 'KB-1',
      title: 'Pick a cache',
      kind: 'decision',
      state: 'done',
      created: '2026-11-01',
      decider: 'owner',
      answer: 'The response store',
      answered_at: '2026-11-02T10:00:00Z',
    }),
    'work/items/KB-2-acquire-foo-corp.md': fm({
      id: 'KB-2',
      title: 'Acquire Foo Corp',
      kind: 'decision',
      state: 'done',
      created: '2026-11-01',
      decider: 'owner',
      classification: 'confidential',
      answer: 'Yes, bid 12M for Foo Corp',
      answered_at: '2026-11-03T10:00:00Z',
    }),
  });
  const { code, result } = await r.hitld(['kb', 'index']);
  assert.equal(code, 0, JSON.stringify(result));
  const text = readFileSync(join(r.root, 'kb/decisions.md'), 'utf8');
  assert.match(text, /- KB-1 \(2026-11-02\): Pick a cache\. Answer: The response store/);
  assert.ok(!/Foo Corp|KB-2/.test(text), 'the confidential decision is not in decisions.md');
  // The check compares decisions.md with the same public list: current, no warning.
  const checked = await r.hitld(['kb', 'check']);
  assert.ok(!checked.result.warnings.some((/** @type {any} */ w) => w.kind === 'decisions'));

  // A repository whose files are internal by default lists no decision without a public label.
  put(r.root, {
    '.human-in-the-lead/tracker.json': JSON.stringify({
      schema_version: 1,
      default_classification: 'internal',
    }),
  });
  await r.hitld(['kb', 'index']);
  assert.match(readFileSync(join(r.root, 'kb/decisions.md'), 'utf8'), /None answered yet\./);
});

test('kb index never writes outside kb/ or over a file it did not generate (review 2 to 4)', async () => {
  const budgets = { ...budgetsOf(null), indexTokensMax: 10 };
  const r = repoWith({
    'docs/index.md': '# Hand-written docs index\n',
    'kb/a.md': fm({ summary: 'Note a.', areas: '[alpha]' }),
    'kb/b.md': fm({ summary: 'Note b.', areas: '[beta]' }),
    'kb/escape.md': fm({ summary: 'Escapes.', areas: '["../../docs"]' }),
    // In a generated file's place, written by hand: no mark on the third line.
    'kb/areas/beta/index.md': fm({ summary: 'The beta area, by hand.' }),
    // Says the mark, but not as the third line: a note, never removed.
    'kb/areas/gamma/index.md': fm({ summary: `Mentions ${GENERATED_MARK} in passing.` }),
  });
  const kb = loadKnowledgeBase(r.root, { defaultClassification: 'public' });
  assert.deepEqual(kb.generated.size, 0);
  assert.ok(kb.notes.some((n) => n.path === 'areas/gamma/index.md'));
  const index = buildIndex(kb, budgets);
  assert.equal(index.split, true);
  assert.ok(index.skipped.includes('kb/escape.md'), 'an area that is not a name is not listed');
  assert.ok(![...index.files.keys()].some((k) => k.includes('..')));
  const done = writeGenerated(kb, index.files);
  assert.deepEqual(done.refused, ['kb/areas/beta/index.md']);
  assert.equal(
    readFileSync(join(r.root, 'kb/areas/beta/index.md'), 'utf8'),
    fm({ summary: 'The beta area, by hand.' }),
  );
  assert.equal(readFileSync(join(r.root, 'docs/index.md'), 'utf8'), '# Hand-written docs index\n');
  assert.ok(existsSync(join(r.root, 'kb/areas/gamma/index.md')));
  assert.throws(
    () => writeGenerated(kb, new Map([['areas/../../docs/index.md', 'x']])),
    /not a place for a generated file/,
  );
  assert.throws(() => writeGenerated(kb, new Map([['notes.md', 'x']])), /not a place/);

  // Through the command: refused files make it fail and are named; nothing else is touched.
  const cli = await r.hitld(['kb', 'index']);
  assert.equal(cli.result.ok, true, JSON.stringify(cli.result));
  const small = repoWith({
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'kb-repo', key: 'KB' },
    }),
    'kb/a.md': fm({ summary: 'Note a.', areas: '[alpha]' }),
    'kb/index.md': '# My own index\n\nNot generated.\n',
  });
  const refused = await small.hitld(['kb', 'index']);
  assert.equal(refused.code, 1);
  assert.deepEqual(refused.result.refused, ['kb/index.md']);
  assert.deepEqual(refused.result.written, ['kb/decisions.md']);
  assert.match(refused.result.message, /not overwritten/);
  assert.equal(
    readFileSync(join(small.root, 'kb/index.md'), 'utf8'),
    '# My own index\n\nNot generated.\n',
  );
});

test('a megabyte of brackets, parentheses or backticks is checked in bounded time (review 5)', () => {
  const root = realpathSync(tempDir('hitld-kb-big-'));
  git(root, 'init', '-q', '-b', 'main');
  const mb = 1024 * 1024;
  put(root, {
    'kb/brackets.md': fm({ summary: 'Brackets.' }, `${'['.repeat(mb)}\n`),
    'kb/parens.md': fm({ summary: 'Parens.' }, `${'('.repeat(mb)}\n`),
    'kb/links.md': fm({ summary: 'Links.' }, `${'](x'.repeat(mb / 3)}\n`),
    'kb/ticks.md': fm({ summary: 'Ticks.' }, `${'`a'.repeat(mb / 2)}\n`),
    'kb/fences.md': fm({ summary: 'Fences.' }, '```\n'.repeat(mb / 4)),
    'kb/glossary.md': fm({ summary: 'Terms.' }, `- **a**: ${'(['.repeat(mb / 2)}\n`),
  });
  const started = Date.now();
  const kb = loadKnowledgeBase(root, { defaultClassification: 'public' });
  // Scanned even with no budget to skip them by: the scanners are linear and capped.
  const unbounded = { ...budgetsOf(null), noteTokensMax: 10 * mb };
  checkKnowledgeBase(kb, unbounded, { stale: false });
  checkKnowledgeBase(kb, budgetsOf(null), { stale: false });
  searchKnowledgeBase(kb, { terms: ['a', 'x'] });
  parseGlossary(`- **a**: ${'(['.repeat(mb / 2)}`);
  const ms = Date.now() - started;
  assert.ok(ms < 5000, `took ${ms} ms`);
});

test('search shows only what the index lists: no note above public, none with invalid front matter, at most 20 results (review 6, 7)', async () => {
  /** @type {Record<string, string>} */
  const files = {
    'kb/secret.md': fm({ summary: 'Vendor plan.', classification: 'confidential' }, 'vendor\n'),
    'kb/odd.md': fm({ summary: 'Odd label.', classification: 'top-secret' }, 'vendor\n'),
    'kb/unlabeled.md': fm({ summary: 'No label.' }, 'vendor\n'),
  };
  for (let i = 0; i < 25; i++)
    files[`kb/many/n${i}.md`] = fm({ summary: `Note ${i}.` }, 'vendor\n');
  const r = repoWith(files);
  const found = await r.hitld(['kb', 'search', 'vendor']);
  assert.equal(found.result.count, 20);
  assert.equal(found.result.total, 26, 'the 25 notes and the unlabeled one, public by default');
  const paths = found.result.results.map((/** @type {any} */ x) => x.path);
  assert.ok(!paths.includes('kb/secret.md'));
  assert.ok(!paths.includes('kb/odd.md'));

  // Unlabeled notes take the repository's label: internal by default here, so none is shown.
  put(r.root, {
    '.human-in-the-lead/tracker.json': JSON.stringify({
      schema_version: 1,
      default_classification: 'internal',
    }),
  });
  const internal = await r.hitld(['kb', 'search', 'vendor']);
  assert.equal(internal.result.total, 0);
  await r.hitld(['kb', 'index']);
  assert.ok(!readFileSync(join(r.root, 'kb/index.md'), 'utf8').includes('unlabeled.md'));
});

test('the generated files copy one escaped, bounded line; a summary with a line break is invalid (review 8)', async () => {
  const r = repoWith({
    'kb/x.md': fm({ summary: '"a\\n\\n# Injected heading"' }),
    'kb/y.md': fm({ summary: 'See [click](http://evil) <img src=x onerror=1> `code`' }),
  });
  const kb = loadKnowledgeBase(r.root, { defaultClassification: 'public' });
  assert.ok(kb.notes.find((n) => n.path === 'x.md')?.errors.some((e) => /summary/.test(e)));
  const text = /** @type {string} */ (buildIndex(kb, budgetsOf(null)).files.get('index.md'));
  assert.ok(!text.includes('Injected'), 'an invalid note is not listed');
  assert.ok(!/^# Injected/m.test(text));
  assert.match(text, /See \\\[click\\\]\(http:\/\/evil\) \\<img src=x onerror=1\\> \\`code\\`/);
  assert.equal(safeLine('a\n\n# b\u0007c', 100), 'a # b c');
  assert.equal(safeLine('x'.repeat(50), 10), `${'x'.repeat(9)}…`);
  const d = buildDecisions(
    [{ id: 'W-1', title: 'T\n# H', answer: '[a](http://e) <b>'.repeat(40) }],
    [],
  );
  const line = /** @type {string} */ (d.split('\n').find((l) => l.startsWith('- W-1')));
  assert.ok(!d.includes('\n# H'));
  assert.ok(line.includes('\\[a\\]') && line.includes('\\<b\\>'));
  assert.ok(line.length < 700, 'title and answer are bounded');
});

test('hidden entries hold no notes, but a symbolic link there is still refused; kb as a file is an error; supersedes itself is an error (nits)', () => {
  const root = realpathSync(tempDir('hitld-kb-nits-'));
  git(root, 'init', '-q', '-b', 'main');
  put(root, {
    'kb/.d/x.md': '# Not a note\n',
    'kb/self.md': fm({ summary: 'Retires itself.', supersedes: '[self.md]' }),
    'outside.md': 'x\n',
  });
  execFileSync('ln', ['-s', '../outside.md', join(root, 'kb/.hidden.md')]);
  execFileSync('ln', ['-s', '../../outside.md', join(root, 'kb/.d/link.md')]);
  const kb = loadKnowledgeBase(root);
  assert.deepEqual(
    kb.notes.map((n) => n.path),
    ['self.md'],
  );
  assert.deepEqual(kinds(checkKnowledgeBase(kb, budgetsOf(null), { stale: false }).errors), [
    'front-matter kb/self.md',
    'unreadable kb/.d/link.md',
    'unreadable kb/.hidden.md',
  ]);
  const file = realpathSync(tempDir('hitld-kb-file-'));
  git(file, 'init', '-q', '-b', 'main');
  put(file, { kb: 'not a directory\n' });
  assert.deepEqual(mergeErrors(file, null, 'public'), ['kb is not a directory']);
});

/**
 * A consumer project whose dispatched W-1 adds a note with a broken link, run through `hitld
 * merge`: the orchestrator's own kbCheck, in the given merge settings.
 * @param {Record<string, unknown>} merge
 */
async function mergeWithBadNote(merge) {
  const c = makeConsumer({
    policy: { merge: { full_suite: ['node --test "test/*.test.js"'], ...merge } },
  });
  const viaPR = merge.via === 'pull-request';
  const remote = join(c.base, 'remote.git');
  let github = null;
  if (viaPR) {
    git(c.base, 'init', '-q', '--bare', '-b', 'main', remote);
    git(c.root, 'remote', 'add', 'origin', remote);
    git(c.root, 'push', '-q', 'origin', 'main');
    github = fakeGitHub({ remote, checks: () => [{ name: 'test', state: 'success' }] });
  }
  /** @param {string[]} argv */
  const hitld = async (argv) => {
    let out = '';
    const exit = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: c.root,
      env: c.env,
      ...(github ? { github: () => /** @type {any} */ (github) } : {}),
    });
    return { exit, result: JSON.parse(out) };
  };
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await hitld(['run', 'start'])).exit, 0);
  const start = await hitld(['dispatch', 'start', 'W-1']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  await hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'agent-1']);
  const branch = start.result.branch;
  git(c.root, 'switch', '-q', '-c', branch);
  put(c.root, {
    'work/items/W-1-add-numbers.md': item({
      id: 'W-1',
      title: 'Add numbers',
      kind: 'work',
      state: 'done',
      touches: ['src/calc.js', 'kb/**'],
    }),
    'kb/numbers.md': fm({ summary: 'How numbers are added.' }, 'See [the guide](gone.md).\n'),
  });
  git(c.root, 'add', '-A');
  git(
    c.root,
    'commit',
    '-q',
    '-m',
    'W-1',
    '-m',
    'Work-Item: W-1\nDispatch: D-1\nAgent-Role: executor',
  );
  const sha = git(c.root, 'rev-parse', 'HEAD');
  if (viaPR) git(c.root, 'push', '-q', 'origin', branch);
  git(c.root, 'switch', '-q', 'main');
  const note = join(c.base, 'note.txt');
  writeFileSync(note, report({ item: 'W-1', sha, branch }));
  const done = await hitld(['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note]);
  assert.equal(done.result.queued_to_merge, branch, JSON.stringify(done.result));
  const before = git(c.root, 'rev-parse', 'main');
  const merged = await hitld(['merge']);
  return { c, merged, before, github };
}

for (const [name, merge] of /** @type {[string, Record<string, unknown>][]} */ ([
  ['queue mode', { mode: 'queue' }],
  ['owner mode', { mode: 'owner' }],
  [
    'owner mode with merge.via pull-request',
    { mode: 'owner', via: 'pull-request', pull_request: { checks: ['test'] } },
  ],
])) {
  test(`hitld merge, ${name}: the orchestrator's kb check sends back a branch with a broken link (review 9)`, async () => {
    const { c, merged, before, github } = await mergeWithBadNote(merge);
    assert.equal(merged.exit, 0, JSON.stringify(merged.result));
    const rejected = merged.result.rejected.map((/** @type {any} */ x) => [x.item, x.reason]);
    assert.deepEqual(rejected, [['W-1', 'knowledge_base']], JSON.stringify(merged.result));
    const x = merged.result.rejected[0];
    assert.match(JSON.stringify(x), /kb\/numbers\.md gone\.md: no such file/);
    assert.match(x.follow_up.message, /fails hitld kb check/);
    assert.equal(git(c.root, 'rev-parse', 'main'), before, 'main did not move');
    assert.deepEqual(merged.result.merged, []);
    if (github) assert.equal(/** @type {any} */ (github).pulls.length, 0);
  });
}
