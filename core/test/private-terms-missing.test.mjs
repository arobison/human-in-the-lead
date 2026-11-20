// HITLD-187: a session with no private store, no device key and so no private term list, as a
// cloud session that has not pulled the store is. The commit hooks, the merge, hitld work check and
// hitld publish check each still pass text that holds no term they know, but each says, by name,
// that the private term list was not checked. A list that is there, even an empty one, says
// nothing of the kind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERMS_KEY, addTerm, loadTerms, removeTerm } from '../lib/store/private-terms.mjs';
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
  assert.deepEqual(warned(listed.result), []);
});

test('no key, no list: the merge checks what it can and says the list was not checked', async () => {
  const c = makeConsumer({
    policy: {
      merge: { mode: 'queue', fast_checks: [], full_suite: ['node --test "test/*.test.js"'] },
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  // The run starts on a local store: no key, so nothing is pulled and no list arrives.
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

  const merged = await c.hitld(['merge'], { env: CLOUD });
  assert.equal(merged.exit, 0, JSON.stringify(merged.result));
  assert.equal(warned(merged.result).length, 1, JSON.stringify(merged.result));
  assert.match(warned(merged.result)[0], /the private store here holds no term list/);
  assert.ok(!JSON.stringify(merged.result).includes('sample-store'));
  assert.ok(readFileSync(join(c.root, 'src', 'sub.js'), 'utf8').length > 0);
});
