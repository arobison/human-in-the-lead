// HITLD-824: before the queue presents a pull request (merge.via pull-request), it checks the
// branch's diff and commit messages against the private term list, read from the private store.
// A branch that names a term goes back to its executor, told where by kind and line, never the
// term, and is not presented; a clean one is presented, and the presentation says the list was read
// (list_found true). With no list there it says list_found false (HITLD-187), and a list that
// cannot be read stops the merge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { main } from '../lib/cli/main.mjs';
import { compileTerms } from '../lib/guard/private-terms.mjs';
import { fakeGitHub } from '../lib/merge/github.mjs';
import { emptyPullState, runPullRequestQueue } from '../lib/merge/pull-request.mjs';
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
 * @param {{ files?: Record<string, string>, message?: string, list?: (store: any) => void }} [o]
 *   list: what the private store holds before the merge reads it
 */
async function waiting(o = {}) {
  const c = makeConsumer({
    policy: {
      merge: {
        mode: 'owner',
        via: 'pull-request',
        pull_request: { checks: ['test'] },
        full_suite: ['node --test "test/*.test.js"'],
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
      /tell the owner the private term list was not checked on these pull requests' diffs and commit messages/,
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

test('the queue checks each commit message too: a term there goes back, named by commit and line (HITLD-824)', async () => {
  const t = await waiting({
    message: `W-1: as agreed with ${TERM}`,
    list: (store) => addTerm(store, { term: TERM }),
  });
  try {
    // The same branch, checked by the queue alone with the list's matchers.
    const result = await runPullRequestQueue({
      repoRoot: t.c.root,
      entries: [{ item: 'W-1', branch: t.branch, dispatch: t.dispatch }],
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

test('a path that holds a term is named by its role, not repeated (HITLD-824)', async () => {
  const dir = TERM.replaceAll(' ', '-');
  const t = await waiting({ files: { [`docs/${dir}.md`]: 'notes\n' } });
  try {
    const result = await runPullRequestQueue({
      repoRoot: t.c.root,
      entries: [{ item: 'W-1', branch: t.branch, dispatch: t.dispatch }],
      settings: {
        mainBranch: 'main',
        remote: 'origin',
        checks: ['test'],
        checkTimeoutMinutes: 60,
        generated: [],
        classification: { ...RULES, terms: compileTerms([{ term: dir, kind: 'name' }]) },
        itemAt: () => ({ state: 'done', title: 'Add numbers', release_note: null, body: '' }),
      },
      policy: { merge: { mode: 'owner' } },
      github: t.github,
      state: emptyPullState(),
      evidence: () => [],
    });
    const [back] = result.rejected;
    assert.match(
      /** @type {string} */ (back.message),
      /the path of a file the branch adds or changes holds a private name/,
    );
    assert.ok(!(/** @type {string} */ (back.message).includes(dir)), 'the path is not repeated');
  } finally {
    rmSync(t.c.base, { recursive: true, force: true });
  }
});
