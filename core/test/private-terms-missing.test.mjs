// HITLD-187: a session with no private store, no device key and so no private term list, as a
// cloud session that has not pulled the store is. The commit hooks, the merge, hitld work check and
// hitld publish check each still pass text that holds no term they know, but each says, by name,
// that the private term list was not checked. A list that is there, even an empty one, says
// nothing of the kind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TERMS_KEY,
  addTerm,
  loadTerms,
  readTermRecords,
  removeTerm,
} from '../lib/store/private-terms.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';
import { STATUS_INPUT, git, makeConsumer, put, report } from './orchestrator-fixture.mjs';

const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));
// Placeholders only: a host on a domain reserved for examples, and a made-up name.
const ADDRESS = 'https://git.example.com/example-owner/sample-store.git';
const NAME = 'Example Partner Co';
// The address arrives in a variable, as a cloud environment sets it; no key is set.
const CLOUD = { HITLD_STORE_REMOTE: ADDRESS };
const NOT_CHECKED = /^the private term list was not checked: /;

/** @param {unknown} r */
const warned = (r) =>
  /** @type {string[]} */ (/** @type {any} */ (r).warnings ?? []).filter((w) =>
    NOT_CHECKED.test(w),
  );

test('loadTerms warns by name when there is no list to read, and not when there is one', () => {
  const c = makeConsumer();
  const root = privateStorePath('orch-fixture', { env: c.env });
  const store = openStore(root);
  assert.equal(existsSync(root), false);
  const none = loadTerms({ store, projectId: 'orch-fixture', env: c.env });
  assert.equal(none.list_found, false);
  assert.equal(none.matchers.length, 0);
  assert.match(warned(none)[0], /there is no private store here, so no term was checked/);
  // With the address in a variable, the implied terms are checked, and the warning says only those.
  const cloud = loadTerms({ store, projectId: 'orch-fixture', env: { ...c.env, ...CLOUD } });
  assert.equal(cloud.list_found, false);
  assert.match(warned(cloud)[0], /only the 2 term\(s\) implied here/);
  // A store with no list (run start made it, nothing was pulled).
  store.write('notes.txt', 'x\n');
  assert.match(
    warned(loadTerms({ store, projectId: 'orch-fixture', env: c.env }))[0],
    /the private store here holds no term list/,
  );
  // A list with every term removed is still a list that was read.
  addTerm(store, { term: NAME });
  removeTerm(store, { which: NAME });
  const empty = loadTerms({ store, projectId: 'orch-fixture', env: c.env });
  assert.equal(empty.list_found, true);
  assert.deepEqual(warned(empty), []);
  assert.ok(store.read(TERMS_KEY));
});

test('no store, no key, no list: the commit hooks pass and say the list was not checked', async () => {
  const c = makeConsumer();
  const installed = await c.hitld(['install', '--marketplace', CHECKOUT]);
  assert.equal(installed.result.done.message_guard, 'installed');
  assert.equal(existsSync(privateStorePath('orch-fixture', { env: c.env })), false);
  put(c.root, { 'docs/setup.md': '# Setup\n\nSync from a device.\n' });
  git(c.root, 'add', '-A');
  const commit = spawnSync('git', ['commit', '-q', '-m', 'docs: setup'], {
    cwd: c.root,
    encoding: 'utf8',
    env: { ...process.env, ...c.env, ...CLOUD },
  });
  assert.equal(commit.status, 0, commit.stderr);
  // Both hooks print their result: the warning reaches whoever ran the commit.
  const out = commit.stdout + commit.stderr;
  assert.equal(out.match(/the private term list was not checked/g)?.length, 2, out);
  assert.ok(!out.includes('sample-store'), 'no hook prints the address');

  const staged = await c.hitld(['check', 'classification', '--staged'], { env: CLOUD });
  assert.equal(staged.result.ok, true);
  assert.equal(warned(staged.result).length, 1);
  const msg = join(c.base, 'msg');
  writeFileSync(msg, 'subject\n');
  const message = await c.hitld(['check', 'commit-message', msg], { env: CLOUD });
  assert.equal(message.result.ok, true);
  assert.equal(warned(message.result).length, 1);
});

test('no store, no key, no list: work check and publish check say the list was not checked', async () => {
  const c = makeConsumer();
  const work = await c.hitld(['work', 'check'], { env: CLOUD });
  assert.equal(warned(work.result).length, 1, JSON.stringify(work.result));

  const body = join(c.base, 'body.md');
  writeFileSync(body, '## Summary\n\nPushed to the store repository.\n');
  for (const env of [{}, CLOUD]) {
    const r = await c.hitld(['publish', 'check', '--file', body], { env });
    assert.equal(r.exit, 0);
    assert.equal(warned(r.result).length, 1);
    assert.match(r.result.message, /the private term list was not checked/);
    assert.equal(r.result.list_found, false);
    assert.doesNotMatch(r.result.message, /it may be posted|the list is empty/);
    assert.ok(!JSON.stringify(r.result).includes('sample-store'));
  }
  // The address is still found, from the variable, without the list.
  writeFileSync(body, `Pushed to ${ADDRESS}.\n`);
  const found = await c.hitld(['publish', 'check', '--file', body], { env: CLOUD });
  assert.equal(found.result.error, 'private-term');
  assert.equal(warned(found.result).length, 1);

  // Once the list is there, no warning.
  await c.hitld(['private', 'add', NAME]);
  writeFileSync(body, 'Pushed to the store repository.\n');
  const listed = await c.hitld(['publish', 'check', '--file', body], { env: CLOUD });
  assert.equal(listed.result.message, 'no private term found: it may be posted');
  assert.equal(listed.result.list_found, true);
  assert.deepEqual(warned(listed.result), []);
});

/**
 * A queue-mode consumer whose run started with an address and no key, so nothing was pulled and no
 * list arrived, with W-1 finished on its branch and waiting to merge.
 * @param {Record<string, unknown>} [merge] more merge policy
 */
async function waitingWithoutList(merge = {}) {
  const c = makeConsumer({
    policy: {
      merge: {
        mode: 'queue',
        fast_checks: [],
        full_suite: ['node --test "test/*.test.js"'],
        ...merge,
      },
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  const start = await c.hitld(['run', 'start'], { env: CLOUD });
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  const root = privateStorePath('orch-fixture', { env: c.env });
  assert.equal(existsSync(join(root, ...TERMS_KEY.split('/'))), false);
  const d = await c.hitld(['dispatch', 'start', 'W-1'], { env: CLOUD });
  assert.equal(d.exit, 0, JSON.stringify(d.result));
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'agent-1'], {
    env: CLOUD,
  });
  const branch = d.result.branch;
  git(c.root, 'switch', '-q', '-c', branch);
  put(c.root, { 'src/sub.js': 'export const sub = (a, b) => a - b;\n' });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '--no-verify', '-m', 'W-1');
  const sha = git(c.root, 'rev-parse', 'HEAD');
  git(c.root, 'switch', '-q', 'main');
  const note = join(c.base, 'note.txt');
  writeFileSync(note, report({ item: 'W-1', sha, branch }));
  const done = await c.hitld(['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note], {
    env: CLOUD,
  });
  assert.equal(done.result.queued_to_merge, branch, JSON.stringify(done.result));
  return { c, root };
}

test('no key, no list, merge.require_private_list off (the default): the merge checks what it can and warns', async () => {
  const { c } = await waitingWithoutList();
  const before = git(c.root, 'rev-parse', 'main');
  const merged = await c.hitld(['merge'], { env: CLOUD });
  assert.equal(merged.exit, 0, JSON.stringify(merged.result));
  assert.equal(warned(merged.result).length, 1, JSON.stringify(merged.result));
  assert.match(warned(merged.result)[0], /the private store here holds no term list/);
  assert.ok(!JSON.stringify(merged.result).includes('sample-store'));
  assert.notEqual(git(c.root, 'rev-parse', 'main'), before, 'main moved');
  assert.ok(readFileSync(join(c.root, 'src', 'sub.js'), 'utf8').length > 0);
});

test('no key, no list, merge.require_private_list on: the merge refuses and main does not move; with a list it merges', async () => {
  const { c, root } = await waitingWithoutList({ require_private_list: true });
  const before = git(c.root, 'rev-parse', 'main');
  const refused = await c.hitld(['merge'], { env: CLOUD });
  assert.equal(refused.result.ok, false, JSON.stringify(refused.result));
  assert.equal(refused.result.error, 'private-list-invalid');
  assert.match(refused.result.message, /^the private term list was not checked: /);
  assert.match(refused.result.message, /merge\.require_private_list is on, so nothing merged/);
  assert.ok(!refused.result.message.includes(root), 'never the store path');
  assert.ok(!JSON.stringify(refused.result).includes('sample-store'));
  assert.equal(git(c.root, 'rev-parse', 'main'), before, 'main did not move');
  // Once the list is there (as a pull would bring it), the same merge goes through, unwarned.
  addTerm(openStore(root), { term: NAME });
  const merged = await c.hitld(['merge'], { env: CLOUD });
  assert.equal(merged.exit, 0, JSON.stringify(merged.result));
  assert.deepEqual(warned(merged.result), []);
  assert.notEqual(git(c.root, 'rev-parse', 'main'), before, 'main moved');
});

test('an empty list file counts as no list; a list that cannot be read refuses by its code, never its path', () => {
  const c = makeConsumer();
  const root = privateStorePath('orch-fixture', { env: c.env });
  const store = openStore(root);
  const file = join(root, ...TERMS_KEY.split('/'));
  for (const text of ['', '\n\n', '  \n']) {
    store.write(TERMS_KEY, text);
    const t = loadTerms({ store, projectId: 'orch-fixture', env: c.env });
    assert.equal(t.list_found, false, JSON.stringify(text));
    assert.match(warned(t)[0], /the private term list here is empty/);
  }
  // A line that does not read: refused, naming the key in the store, not the store's path.
  store.write(TERMS_KEY, 'not json\n');
  assert.throws(
    () => readTermRecords(store),
    (/** @type {any} */ e) =>
      e.code === 'private-list-invalid' &&
      !e.message.includes(root) &&
      e.message.includes(TERMS_KEY),
  );
  // A directory where the list goes: a coded refusal, not the system's error with its path.
  rmSync(file);
  mkdirSync(file);
  assert.throws(
    () => loadTerms({ store, projectId: 'orch-fixture', env: c.env }),
    (/** @type {any} */ e) =>
      e.code === 'private-list-invalid' &&
      /\(EISDIR\)/.test(e.message) &&
      !e.message.includes(root),
  );
});

test('no policy.json: the hooks still check the address in use and say the list was not checked', async () => {
  const c = makeConsumer();
  rmSync(join(c.root, '.human-in-the-lead', 'policy.json'));
  const staged = await c.hitld(['check', 'classification', '--staged'], { env: CLOUD });
  assert.equal(staged.result.ok, true, JSON.stringify(staged.result));
  assert.match(warned(staged.result)[0], /there is no project ID \(policy\.json\)/);
  assert.match(warned(staged.result)[0], /only the 2 term\(s\) of the store address in use/);
  const msg = join(c.base, 'msg');
  writeFileSync(msg, 'subject\n');
  const clean = await c.hitld(['check', 'commit-message', msg], { env: CLOUD });
  assert.equal(clean.result.ok, true);
  assert.equal(warned(clean.result).length, 1);
  // The address is found without a policy, from the variable alone.
  writeFileSync(msg, `pushed to ${ADDRESS}\n`);
  const found = await c.hitld(['check', 'commit-message', msg], { env: CLOUD });
  assert.equal(found.result.error, 'private-term');
  assert.ok(!JSON.stringify(found.result).includes('sample-store'));
  const none = await c.hitld(['check', 'commit-message', msg]);
  assert.match(warned(none.result)[0], /and no term was checked/);
  // work check refuses without a policy at all, so it never reports clean here.
  const work = await c.hitld(['work', 'check'], { env: CLOUD });
  assert.equal(work.result.error, 'policy', JSON.stringify(work.result));
});
