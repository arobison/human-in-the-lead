import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { moveOldWindowsData } from '../lib/store/data-home.mjs';
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

/**
 * A home with a store at the old Windows place (~/.local/share/human-in-the-lead): a project's
 * store, with a nested file, and the machine directory.
 */
function oldWindowsHome() {
  const home = tempDir('hitld-win-home-');
  const old = join(home, '.local', 'share', 'human-in-the-lead');
  mkdirSync(join(old, 'p', 'runs', 'R-1'), { recursive: true });
  writeFileSync(join(old, 'p', 'ledger.jsonl'), '{"a":1}\n');
  writeFileSync(join(old, 'p', 'runs', 'R-1', 'run-state.json'), '{}');
  mkdirSync(join(old, '_machine'));
  writeFileSync(join(old, '_machine', 'machine.json'), '{"schema_version":1}');
  const local = join(home, 'AppData', 'Local');
  return { home, old, local, env: { LOCALAPPDATA: local } };
}

test('on Windows a store at the old place is moved once, with a message, and nothing is lost', () => {
  const { home, old, local, env } = oldWindowsHome();
  /** @type {string[]} */
  const messages = [];
  const o = {
    env,
    home,
    platform: /** @type {const} */ ('win32'),
    report: (/** @type {string} */ m) => messages.push(m),
  };
  const first = moveOldWindowsData(o);
  assert.deepEqual(first.moved, ['_machine', 'p']);
  assert.deepEqual(first.left, []);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /moved _machine, p from .* to .*human-in-the-lead/);
  const now = join(local, 'human-in-the-lead');
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  assert.equal(readFileSync(join(now, 'p', 'runs', 'R-1', 'run-state.json'), 'utf8'), '{}');
  assert.equal(readFileSync(join(now, '_machine', 'machine.json'), 'utf8'), '{"schema_version":1}');
  assert.equal(existsSync(old), false, 'the old directory is gone once it is empty');
  assert.equal(openStore(privateStorePath('p', o)).read('ledger.jsonl'), '{"a":1}\n');

  const second = moveOldWindowsData(o);
  assert.deepEqual(
    [second.moved, second.left, messages.length],
    [[], [], 1],
    'a second run does nothing',
  );
});

test('the move leaves an entry that is at both places, and says so', () => {
  const { home, old, local, env } = oldWindowsHome();
  mkdirSync(join(local, 'human-in-the-lead', 'p'), { recursive: true });
  writeFileSync(join(local, 'human-in-the-lead', 'p', 'ledger.jsonl'), 'new\n');
  /** @type {string[]} */
  const messages = [];
  const r = moveOldWindowsData({ env, home, platform: 'win32', report: (m) => messages.push(m) });
  assert.deepEqual([r.moved, r.left], [['_machine'], ['p']]);
  assert.equal(readFileSync(join(old, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  assert.equal(
    readFileSync(join(local, 'human-in-the-lead', 'p', 'ledger.jsonl'), 'utf8'),
    'new\n',
  );
  assert.ok(messages.some((m) => /p is at both places/.test(m)));
});

test('nothing moves off Windows or with XDG_DATA_HOME set', () => {
  const { home, old, env } = oldWindowsHome();
  const report = () => assert.fail('no message');
  for (const o of [
    { env, home, platform: /** @type {const} */ ('linux'), report },
    {
      env: { ...env, XDG_DATA_HOME: join(home, 'data') },
      home,
      platform: /** @type {const} */ ('win32'),
      report,
    },
  ]) {
    assert.deepEqual(moveOldWindowsData(o).moved, []);
  }
  assert.equal(existsSync(join(old, 'p', 'ledger.jsonl')), true);
});

test('resolving the store path on Windows moves the old store first', () => {
  const { home, local, env } = oldWindowsHome();
  const path = privateStorePath('p', { env, home, platform: 'win32', report: () => {} });
  assert.equal(path, join(local, 'human-in-the-lead', 'p'));
  assert.equal(readFileSync(join(path, 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
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
