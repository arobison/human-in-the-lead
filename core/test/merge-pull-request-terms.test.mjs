// HITLD-824: before the queue presents a pull request (merge.via pull-request), it checks the
// branch's diff and commit messages against the private term list, read from the private store.
// A branch that names a term goes back to its executor, told where (by kind and line, a path by
// its role), never the term, and is not presented; a clean one is presented, and the merge says
// the list was read (list_found true, one value for the run). With no list there it says
// list_found false (HITLD-187); a list that cannot be read, or no list with
// merge.require_private_list on, stops the merge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { main } from '../lib/cli/main.mjs';
import { compileTerms } from '../lib/guard/private-terms.mjs';
import { fakeGitHub } from '../lib/merge/github.mjs';
import { HIDDEN_PATH, emptyPullState, runPullRequestQueue } from '../lib/merge/pull-request.mjs';
import { readLedger } from '../lib/ledger/ledger.mjs';
import { TERMS_KEY, addTerm } from '../lib/store/private-terms.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { STATUS_INPUT, git, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';

// A made-up name, standing in for a term on the private term list.
const TERM = 'Example Partner Co';
const RULES = {
  ceiling: 'public',
  defaultClassification: 'public',
  privatePaths: [],
  terms: compileTerms([{ term: TERM, kind: 'name', id: 'PT-1' }]),
};

/**
 * A consumer in owner mode merging through pull requests, against a fake GitHub whose repository
 * is a bare remote, with W-1 finished on its pushed branch and waiting to merge.
 * @param {{ files?: Record<string, string>, message?: string, list?: (store: any) => void,
 *   merge?: Record<string, unknown> }} [o]
 *   list: what the private store holds before the merge reads it; merge: more merge policy
 */
async function waiting(o = {}) {
  const c = makeConsumer({
    policy: {
      merge: {
        mode: 'owner',
        via: 'pull-request',
        pull_request: { checks: ['test'] },
        full_suite: ['node --test "test/*.test.js"'],
        ...(o.merge ?? {}),
      },
    },
  });
  const remote = join(c.base, 'remote.git');
  git(c.base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(c.root, 'remote', 'add', 'origin', remote);
  git(c.root, 'push', '-q', 'origin', 'main');
  const github = fakeGitHub({ remote, checks: () => [{ name: 'test', state: 'success' }] });
  /** @param {string[]} argv */
  const hitld = async (argv) => {
    let out = '';
    const exit = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: c.root,
      env: c.env,
      github: () => github,
    });
    return { exit, result: JSON.parse(out) };
  };
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await hitld(['run', 'start'])).exit, 0);
  const start = await hitld(['dispatch', 'start', 'W-1']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  const dispatch = start.result.dispatch;
  await hitld(['dispatch', 'handle', '--dispatch', dispatch, '--harness-ref', 'agent-1']);
  const branch = start.result.branch;
  git(c.root, 'switch', '-q', '-c', branch);
  put(c.root, {
    'work/items/W-1-add-numbers.md': item({
      id: 'W-1',
      title: 'Add numbers',
      kind: 'work',
      state: 'done',
      touches: ['src/calc.js'],
    }),
    'src/calc.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
    ...(o.files ?? {}),
  });
  git(c.root, 'add', '-A');
  git(
    c.root,
    'commit',
    '-q',
    '--no-verify',
    '-m',
    o.message ?? 'W-1',
    '-m',
    `Work-Item: W-1\nDispatch: ${dispatch}\nAgent-Role: executor`,
  );
  const sha = git(c.root, 'rev-parse', 'HEAD');
  git(c.root, 'push', '-q', 'origin', branch);
  git(c.root, 'switch', '-q', 'main');
  const note = join(c.base, 'note.txt');
  writeFileSync(note, report({ item: 'W-1', sha, branch }));
  const done = await hitld(['dispatch', 'complete', '--dispatch', dispatch, '--report-file', note]);
  assert.equal(done.result.queued_to_merge, branch, JSON.stringify(done.result));
  const root = privateStorePath('orch-fixture', { env: c.env });
  o.list?.(openStore(root));
  return { c, hitld, github, branch, dispatch, root };
}

test('a diff whose file names a private term goes back to its executor by kind and line; no pull request is opened (HITLD-824)', async () => {
  const t = await waiting({
    files: { 'docs/notes.md': `# Notes\n\nSynced with ${TERM} weekly.\n` },
    list: (store) => addTerm(store, { term: TERM }),
  });
  try {
    const shown = await t.hitld(['merge']);
    assert.equal(shown.exit, 0, JSON.stringify(shown.result));
    assert.equal(shown.result.list_found, true);
    assert.deepEqual(shown.result.presented, []);
    assert.equal(t.github.pulls.length, 0, 'no pull request opened');
    const [back] = shown.result.rejected;
    assert.equal(back.item, 'W-1');
    assert.equal(back.reason, 'classification');
    assert.equal(back.follow_up.dispatch, t.dispatch);
    assert.match(
      back.follow_up.message,
      /checked your branch's diff and commit messages against the private term list/,
    );
    assert.match(back.follow_up.message, /docs\/notes\.md, line 3: holds a private name/);
    assert.match(back.follow_up.message, /The pull request is not presented/);
    assert.ok(!JSON.stringify(shown.result).includes(TERM), 'never the term');
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

test('a clean diff is presented, and the presentation says the list was read: list_found true (HITLD-824)', async () => {
  const t = await waiting({ list: (store) => addTerm(store, { term: TERM }) });
  try {
    const shown = await t.hitld(['merge']);
    assert.equal(shown.exit, 0, JSON.stringify(shown.result));
    assert.deepEqual(
      shown.result.presented.map((/** @type {any} */ b) => b.item),
      ['W-1'],
    );
    assert.equal(shown.result.list_found, true);
    assert.deepEqual(shown.result.rejected, []);
    assert.doesNotMatch(shown.result.next, /private term list was not checked/);
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

test('no list there: the pull request is presented with list_found false, and the owner is told (HITLD-187, HITLD-824)', async () => {
  const t = await waiting();
  try {
    const shown = await t.hitld(['merge']);
    assert.equal(shown.exit, 0, JSON.stringify(shown.result));
    assert.equal(shown.result.list_found, false);
    assert.equal(shown.result.presented.length, 1);
    assert.ok(
      (shown.result.warnings ?? []).some((/** @type {string} */ w) =>
        /^the private term list was not checked: /.test(w),
      ),
      JSON.stringify(shown.result),
    );
    assert.match(
      shown.result.next,
      /tell the owner the private term list was not read for this run, so these pull requests' diffs and commit messages were checked only against the terms implied here \(list_found false, one value for the run/,
    );
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

test('a list that cannot be read stops the merge: nothing is presented, and the refusal never names the store path (HITLD-187, HITLD-824)', async () => {
  const t = await waiting({
    list: (store) => {
      addTerm(store, { term: TERM });
      store.write(TERMS_KEY, 'not json\n');
    },
  });
  try {
    const refused = await t.hitld(['merge']);
    assert.equal(refused.result.ok, false, JSON.stringify(refused.result));
    assert.equal(refused.result.error, 'private-list-invalid');
    assert.match(refused.result.message, /nothing merged$/);
    assert.ok(!refused.result.message.includes(t.root), 'never the store path');
    assert.equal(t.github.pulls.length, 0, 'no pull request opened');
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

test('merge.require_private_list on and no list: the merge refuses, and no pull request is opened or presented (HITLD-187, HITLD-824)', async () => {
  const t = await waiting({ merge: { require_private_list: true } });
  try {
    const refused = await t.hitld(['merge']);
    assert.equal(refused.result.ok, false, JSON.stringify(refused.result));
    assert.equal(refused.result.error, 'private-list-invalid');
    assert.match(refused.result.message, /merge\.require_private_list is on, so nothing merged/);
    assert.ok(!refused.result.message.includes(t.root), 'never the store path');
    assert.equal(t.github.pulls.length, 0, 'no pull request opened');
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

test('a path that holds a term is never printed: not in the result, its problems, the follow-up or the ledger (HITLD-824)', async () => {
  const dir = TERM.replaceAll(' ', '-');
  const t = await waiting({
    files: { [`docs/${dir}/notes.md`]: 'notes\n' },
    list: (store) => addTerm(store, { term: dir }),
  });
  try {
    const shown = await t.hitld(['merge']);
    assert.equal(shown.exit, 0, JSON.stringify(shown.result));
    const [back] = shown.result.rejected;
    assert.equal(back.reason, 'classification');
    assert.deepEqual(back.files, []);
    assert.equal(back.problems.length, 1);
    assert.ok(back.problems[0].startsWith(`${HIDDEN_PATH}: its path holds a private name`));
    assert.match(
      back.follow_up.message,
      /the path of a file the branch adds or changes holds a private name/,
    );
    assert.equal(t.github.pulls.length, 0, 'no pull request opened');
    const printed = JSON.stringify(shown.result);
    assert.ok(!printed.includes(dir), 'the result never holds the path');
    const ledger = JSON.stringify(readLedger(openStore(t.root)).events);
    assert.ok(
      ledger.includes('merge queue (pull request): classification'),
      'the refusal is recorded',
    );
    assert.ok(!ledger.includes(dir), 'the ledger never holds the path');
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

/**
 * The queue alone, with the list's matchers, over the given branches of the consumer.
 * @param {Awaited<ReturnType<typeof waiting>>} t @param {import('../lib/merge/queue.mjs').Entry[]} entries
 */
const queue = (t, entries) =>
  runPullRequestQueue({
    repoRoot: t.c.root,
    entries,
    settings: {
      mainBranch: 'main',
      remote: 'origin',
      checks: ['test'],
      checkTimeoutMinutes: 60,
      generated: [],
      classification: RULES,
      itemAt: () => ({ state: 'done', title: 'Add numbers', release_note: null, body: '' }),
    },
    policy: { merge: { mode: 'owner' } },
    github: t.github,
    state: emptyPullState(),
    evidence: () => [],
  });

/**
 * Another branch from main, committed and pushed, beside W-1.
 * @param {Awaited<ReturnType<typeof waiting>>} t @param {string} id
 * @param {Record<string, string>} files
 */
function another(t, id, files) {
  const branch = `hitld/${id}`;
  git(t.c.root, 'switch', '-q', '-c', branch, 'main');
  put(t.c.root, files);
  git(t.c.root, 'add', '-A');
  git(t.c.root, 'commit', '-q', '--no-verify', '-m', id, '-m', `Work-Item: ${id}`);
  git(t.c.root, 'push', '-q', 'origin', branch);
  git(t.c.root, 'switch', '-q', 'main');
  return { item: id, branch, dispatch: `D-${id}` };
}

test('the queue checks each commit message too: a term there goes back, named by commit and line (HITLD-824)', async () => {
  const t = await waiting({ message: `W-1: as agreed with ${TERM}` });
  try {
    const result = await queue(t, [{ item: 'W-1', branch: t.branch, dispatch: t.dispatch }]);
    const [back] = result.rejected;
    assert.equal(back.reason, 'classification');
    assert.match(
      /** @type {string} */ (back.message),
      /commit [0-9a-f]{12} message, line 1: holds a private name/,
    );
    assert.ok(!JSON.stringify(result).includes(TERM), 'never the term');
    assert.equal(t.github.pulls.length, 0);
    assert.equal(result.awaiting_owner.length, 0);
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

test('a branch with a term and a file above the ceiling is told both (HITLD-824)', async () => {
  const t = await waiting({
    files: {
      'docs/notes.md': `# Notes\n\nSynced with ${TERM} weekly.\n`,
      'docs/plan.md': '---\nclassification: confidential\n---\n\n# Plan\n',
    },
  });
  try {
    const result = await queue(t, [{ item: 'W-1', branch: t.branch, dispatch: t.dispatch }]);
    const [back] = result.rejected;
    const message = /** @type {string} */ (back.message);
    assert.match(message, /docs\/notes\.md, line 3: holds a private name/);
    assert.match(message, /The queue also refuses the branch for these: docs\/plan\.md: /);
    assert.match(message, /classification ceiling belongs in the private store/);
    assert.deepEqual(back.files?.sort(), ['docs/notes.md', 'docs/plan.md']);
    assert.ok(!JSON.stringify(result).includes(TERM), 'never the term');
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});

test('two pull requests in one run: the clean one is presented, the one that names a term goes back (HITLD-824)', async () => {
  const t = await waiting();
  try {
    const w2 = another(t, 'W-2', { 'docs/w2.md': `# W-2\n\nFor ${TERM}.\n` });
    const result = await queue(t, [{ item: 'W-1', branch: t.branch, dispatch: t.dispatch }, w2]);
    assert.deepEqual(
      result.awaiting_owner.map((w) => w.item),
      ['W-1'],
    );
    assert.deepEqual(
      result.rejected.map((x) => [x.item, x.reason]),
      [['W-2', 'classification']],
    );
    assert.match(
      /** @type {string} */ (result.rejected[0].message),
      /docs\/w2\.md, line 3: holds a private name/,
    );
    assert.equal(t.github.pulls.length, 1, 'only the clean branch has a pull request');
    assert.ok(!JSON.stringify(result).includes(TERM), 'never the term');
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});
