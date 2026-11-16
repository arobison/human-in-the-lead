import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realPath, renameReplacing } from '../lib/platform/fs.mjs';

/** A rename that fails with `code` the first `times` calls, then succeeds. @param {string} code @param {number} times */
function flaky(code, times) {
  const calls = { n: 0 };
  const rename = () => {
    calls.n++;
    if (calls.n <= times) throw Object.assign(new Error(code), { code });
  };
  return { calls, rename };
}

test('a rename held up by another process is tried again on Windows', () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    const f = flaky(code, 2);
    renameReplacing('a', 'b', { rename: f.rename, platform: 'win32' });
    assert.equal(f.calls.n, 3, code);
  }
});

test('elsewhere, and for any other error, a rename fails at once', () => {
  const posix = flaky('EPERM', 1);
  assert.throws(
    () => renameReplacing('a', 'b', { rename: posix.rename, platform: 'linux' }),
    /EPERM/,
  );
  assert.equal(posix.calls.n, 1);
  const other = flaky('ENOENT', 1);
  assert.throws(
    () => renameReplacing('a', 'b', { rename: other.rename, platform: 'win32' }),
    /ENOENT/,
  );
  assert.equal(other.calls.n, 1);
});

test('the retries are bounded: a target held for good still fails', () => {
  const held = flaky('EBUSY', Infinity);
  assert.throws(
    () => renameReplacing('a', 'b', { rename: held.rename, platform: 'win32' }),
    /EBUSY/,
  );
  assert.equal(held.calls.n, 9);
});

test('a real rename replaces the target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-platform-'));
  writeFileSync(join(dir, 'from'), 'new');
  writeFileSync(join(dir, 'to'), 'old');
  renameReplacing(join(dir, 'from'), join(dir, 'to'));
  assert.equal(readFileSync(join(dir, 'to'), 'utf8'), 'new');
});

test('realPath agrees with the native call, so two real paths compare equal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-platform-'));
  assert.equal(realPath(dir), realpathSync.native(dir));
  assert.equal(realPath(join(dir, '.')), realPath(dir));
});
