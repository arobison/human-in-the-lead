import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdirSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, sep } from 'node:path';
import { recordFeedback } from '../lib/feedback/record.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { hostEnv, retryBusy } from '../lib/store/host.mjs';
import { tempDir } from './helpers/tmp.mjs';

/** A path written with "/", in this system's separators (Windows: "\"). @param {string} p */
const native = (p) => p.split('/').join(sep);

test('the default store path is ~/.local/share/human-in-the-lead/<project-id>/ off Windows', () => {
  for (const platform of /** @type {const} */ (['linux', 'darwin'])) {
    assert.equal(
      privateStorePath('example-project', {
        env: { LOCALAPPDATA: '/l' },
        home: '/home/o',
        platform,
      }),
      native('/home/o/.local/share/human-in-the-lead/example-project'),
      platform,
    );
  }
});

test('on Windows the default store path is %LOCALAPPDATA%\\human-in-the-lead\\<project-id>', () => {
  const win = { home: '/home/o', platform: /** @type {const} */ ('win32') };
  assert.equal(
    privateStorePath('p', { ...win, env: { LOCALAPPDATA: '/users/o/appdata/local' } }),
    native('/users/o/appdata/local/human-in-the-lead/p'),
  );
  // Without %LOCALAPPDATA% (or with a relative one), the profile's AppData\Local.
  for (const env of [{}, { LOCALAPPDATA: 'relative' }]) {
    assert.equal(
      privateStorePath('p', { ...win, env }),
      native('/home/o/AppData/Local/human-in-the-lead/p'),
    );
  }
});

test('XDG_DATA_HOME is respected when absolute, on every platform', () => {
  for (const platform of /** @type {const} */ (['linux', 'darwin', 'win32'])) {
    assert.equal(
      privateStorePath('p', {
        env: { XDG_DATA_HOME: '/data', LOCALAPPDATA: '/l' },
        home: '/home/o',
        platform,
      }),
      native('/data/human-in-the-lead/p'),
      platform,
    );
  }
  assert.equal(
    privateStorePath('p', {
      env: { XDG_DATA_HOME: 'relative' },
      home: '/home/o',
      platform: 'linux',
    }),
    native('/home/o/.local/share/human-in-the-lead/p'),
  );
});

test('unsafe project IDs are refused', () => {
  for (const id of ['', '..', '../x', 'a/b', 'Upper', '.hidden', 'a..b']) {
    assert.throws(() => privateStorePath(id, { env: {}, home: '/h' }), /not a safe directory/, id);
  }
});

test('a store inside the repository is refused', () => {
  assert.throws(
    () =>
      privateStorePath('p', {
        env: { XDG_DATA_HOME: '/repo/data' },
        home: '/h',
        repoRoot: '/repo',
      }),
    /inside the repository/,
  );
  assert.doesNotThrow(() =>
    privateStorePath('p', { env: {}, home: '/home/o', repoRoot: '/home/o/src/repo' }),
  );
});

test('the store reads, writes atomically, appends and lists', () => {
  const store = openStore(join(tempDir('hitld-store-'), 'p'));
  assert.equal(store.read('ledger.jsonl'), null);
  assert.deepEqual(store.list(), []);
  store.append('ledger.jsonl', '{"a":1}\n');
  store.append('ledger.jsonl', '{"a":2}\n');
  store.write('runs/R-1/run-state.json', '{}');
  store.write('runs/R-1/run-state.json', '{"checkpoint":2}');
  assert.equal(store.read('ledger.jsonl'), '{"a":1}\n{"a":2}\n');
  assert.equal(store.read('runs/R-1/run-state.json'), '{"checkpoint":2}');
  assert.deepEqual(store.list(), ['ledger.jsonl', 'runs/R-1/run-state.json']);
  assert.deepEqual(store.list('runs/'), ['runs/R-1/run-state.json']);
});

/**
 * Run fn with every fs.readdirSync call (the store's among them) shown to spy once it returns.
 * @template T @param {(dir: string) => void} spy @param {() => T} fn @returns {T}
 */
function withReaddirSpy(spy, fn) {
  const original = fs.readdirSync;
  // @ts-ignore a wrapper with the same signature
  fs.readdirSync = (/** @type {any} */ dir, /** @type {any} */ options) => {
    const out = original(dir, options);
    spy(String(dir));
    return out;
  };
  syncBuiltinESMExports();
  try {
    return fn();
  } finally {
    fs.readdirSync = original;
    syncBuiltinESMExports();
  }
}

test('listing feedback/ and finding the next feedback ID read no folder outside it (GitHub issue 603)', () => {
  const tmp = tempDir('hitld-store-');
  const root = join(tmp, 'store');
  const store = openStore(root);
  // A store root beside many worktrees, as in the report: none of them may be read.
  for (let w = 0; w < 30; w++) {
    for (let d = 0; d < 5; d++) {
      const dir = join(root, 'worktrees', `w-${w}`, `d-${d}`);
      mkdirSync(dir, { recursive: true });
      for (let f = 0; f < 5; f++) writeFileSync(join(dir, `f-${f}.txt`), 'x');
    }
  }
  store.write('feedback/FB-1.json', '{}');
  store.write('feedback/FB-7.json', '{}');
  store.write('ledger/w-0123456789abcdef.jsonl', '');
  const cwd = join(tmp, 'elsewhere');
  mkdirSync(cwd);

  /** @type {string[]} */
  const read = [];
  const inStore = (/** @type {string} */ dir) => {
    if (dir === root || dir.startsWith(root + sep)) read.push(dir.slice(root.length + 1));
  };
  const keys = withReaddirSpy(inStore, () => store.list('feedback/'));
  assert.deepEqual(keys, ['feedback/FB-1.json', 'feedback/FB-7.json']);
  assert.deepEqual(read, ['feedback']);

  read.length = 0;
  const { record } = withReaddirSpy(inStore, () =>
    recordFeedback(store, { cwd, kind: 'bug', words: 'slow', defaultHarness: 'test' }),
  );
  assert.equal(record.id, 'FB-8');
  assert.ok(read.includes('feedback'), 'the spy saw the feedback folder read');
  for (const dir of read) {
    const ok = ['feedback', 'ledger'].some((d) => dir === d || dir.startsWith(d + sep));
    assert.ok(ok, `read ${JSON.stringify(dir)}, outside feedback/ and ledger/`);
  }

  // A prefix with no slash reads the top folder, and of its folders only those it can match.
  read.length = 0;
  const loose = withReaddirSpy(inStore, () => store.list('feed'));
  assert.deepEqual(loose, [...keys, 'feedback/FB-8.json']);
  assert.deepEqual(read, ['', 'feedback']);
});

test('a folder removed while list walks the prefix is skipped, not an error', () => {
  const root = join(tempDir('hitld-store-'), 'store');
  const store = openStore(root);
  store.write('run/checkpoints/a/one.json', '{}');
  store.write('run/checkpoints/gone/deep/two.json', '{}');
  store.write('run/checkpoints/z/three.json', '{}');
  const top = join(root, 'run', 'checkpoints');
  let removed = false;
  const keys = withReaddirSpy(
    (dir) => {
      // A worktree cleanup races the walk: the folder goes after it is listed, before it is read.
      // Not rmSync: its recursive helper loads on first use and would keep this spy as its reader.
      if (dir === top) {
        unlinkSync(join(top, 'gone', 'deep', 'two.json'));
        rmdirSync(join(top, 'gone', 'deep'));
        rmdirSync(join(top, 'gone'));
        removed = true;
      }
    },
    () => store.list('run/checkpoints/'),
  );
  assert.ok(removed, 'the folder was removed during the walk');
  assert.deepEqual(keys, ['run/checkpoints/a/one.json', 'run/checkpoints/z/three.json']);
  // The prefix's own folder gone before the walk: no keys, no error.
  rmSync(join(root, 'run'), { recursive: true });
  assert.deepEqual(store.list('run/checkpoints/'), []);
});

test('store keys cannot leave the store', () => {
  const store = openStore(tempDir('hitld-store-'));
  for (const key of ['../x', '/etc/passwd', 'a/../../x', '', 'a\0b']) {
    assert.throws(() => store.read(key), /store key/, key);
  }
  // On Windows a backslash separates too, and a drive or UNC path is absolute.
  if (process.platform === 'win32') {
    for (const key of ['..\\x', 'a\\..\\..\\x', 'C:\\x', 'C:/x', '\\\\server\\share\\x']) {
      assert.throws(() => store.read(key), /store key/, key);
    }
  }
});

test('git is given the system it runs on: HOME as before elsewhere, the profile on Windows', () => {
  const env = {
    PATH: '/bin',
    HOME: '/home/o',
    USERPROFILE: 'C:/Users/o',
    APPDATA: 'C:/Users/o/AppData/Roaming',
    GIT_DIR: '/elsewhere',
    SECRET: 'x',
  };
  assert.deepEqual(hostEnv('/store', { env, platform: 'linux' }), {
    PATH: '/bin',
    HOME: '/home/o',
  });
  assert.deepEqual(hostEnv('/store', { env: { PATH: '/bin' }, platform: 'darwin' }), {
    PATH: '/bin',
    HOME: '/store',
  });
  assert.deepEqual(hostEnv(null, { env, platform: 'linux' }), { PATH: '/bin' });
  // Windows: the profile's variables pass, names in any case; HOME only when it is set.
  const win = { Path: 'C:/bin', userprofile: 'C:/Users/o', SystemRoot: 'C:/Windows', SECRET: 'x' };
  assert.deepEqual(hostEnv('/store', { env: win, platform: 'win32' }), {
    PATH: 'C:/bin',
    USERPROFILE: 'C:/Users/o',
    SystemRoot: 'C:/Windows',
  });
  assert.equal(hostEnv('/store', { env, platform: 'win32' }).HOME, '/home/o');
  assert.equal(hostEnv('/store', { env, platform: 'win32' }).APPDATA, env.APPDATA);
  assert.equal(hostEnv('/store', { env, platform: 'win32' }).GIT_DIR, undefined);
  assert.equal(hostEnv(null, { env, platform: 'win32' }).HOME, undefined);
});

test('a busy file is tried again on Windows only, a bounded number of times', () => {
  const busy = (/** @type {string} */ code) => Object.assign(new Error(code), { code });
  /** @type {number[]} */
  const waits = [];
  const wait = (/** @type {number} */ ms) => void waits.push(ms);
  let tries = 0;
  const flaky = () => {
    if (++tries < 3) throw busy('EBUSY');
    return 'done';
  };
  assert.equal(retryBusy(flaky, { platform: 'win32', wait }), 'done');
  assert.equal(tries, 3);
  assert.equal(waits.length, 2);
  tries = 0;
  assert.throws(() => retryBusy(flaky, { platform: 'linux', wait }), { code: 'EBUSY' });
  assert.equal(tries, 1, 'elsewhere a busy file is an error at once');
  tries = 0;
  const never = () => {
    tries++;
    throw busy('EPERM');
  };
  assert.throws(() => retryBusy(never, { platform: 'win32', wait }), { code: 'EPERM' });
  assert.ok(tries > 1 && tries < 20, 'given up after a few tries');
  tries = 0;
  const missing = () => {
    tries++;
    throw busy('ENOENT');
  };
  assert.throws(() => retryBusy(missing, { platform: 'win32', wait }), { code: 'ENOENT' });
  assert.equal(tries, 1, 'only a busy file is tried again');
});
