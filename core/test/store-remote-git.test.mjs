import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  MAX_BUNDLE_BYTES,
  STORE_BRANCH,
  checkRemoteUrl,
  createGitRemote,
  remoteDir,
} from '../lib/store/remote-git.mjs';
import { StoreRemoteError } from '../lib/store/remote.mjs';
import { storeRemoteConformance } from './helpers/store-remote-conformance.mjs';
import { tempDir } from './helpers/tmp.mjs';

/** Run git on a bare repository, for setting up and inspecting the fake remote. */
const gitIn = (/** @type {string} */ dir, /** @type {string[]} */ args, input = '') => {
  const r = spawnSync('git', args, {
    cwd: dir,
    input,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: dir,
      GIT_DIR: dir,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** A bare repository standing in for the private repository on the host, and a place for clones. */
function fakeHost() {
  const base = tempDir('hitld-remote-git-');
  const bare = join(base, 'store.git');
  mkdirSync(bare);
  gitIn(bare, ['init', '-q', '--bare']);
  let clones = 0;
  return {
    base,
    bare,
    url: `file://${bare}`,
    /** @param {string} [url] */
    open: (url = `file://${bare}`) =>
      createGitRemote({ url, dir: join(base, `clone-${clones++}`, 'remote') }),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

storeRemoteConformance('git transport', () => {
  const host = fakeHost();
  return {
    open: () => host.open(),
    absentVersion: `00000099-${'a'.repeat(64)}`,
    cleanup: host.cleanup,
  };
});

test('a URL that is not a git URL is refused', () => {
  const ok = [
    'https://github.com/owner/store.git',
    'https://github.com/owner/store',
    'ssh://git@github.com/owner/store.git',
    'ssh://git@host:2222/owner/store.git',
    'git@github.com:owner/store.git',
    'file:///srv/stores/store.git',
    '/mnt/drive/store.git',
  ];
  for (const url of ok) assert.equal(checkRemoteUrl(url), url);
  const bad = [
    '',
    'store',
    'store.git',
    '../store.git',
    'github.com/owner/store.git',
    'https://github.com',
    'https://github.com/',
    'http://github.com/owner/store.git',
    'ftp://host/store.git',
    'git://host/store.git',
    'https://user:token@github.com/owner/store.git',
    'ext::sh -c touch /tmp/x',
    'fd::17',
    '--upload-pack=touch /tmp/x',
    '-oProxyCommand=x',
    'https://github.com/owner/store.git extra',
    'https://github.com/owner/\nstore.git',
    'https://github.com\\owner\\store.git',
    'ssh://github.com',
    'github.com:owner/store.git',
    '-@host:path',
  ];
  for (const url of bad) {
    assert.throws(
      () => checkRemoteUrl(url),
      (e) => e instanceof StoreRemoteError && e.code === 'remote-url-invalid',
      `${JSON.stringify(url)} should be refused`,
    );
  }
  assert.throws(() => checkRemoteUrl(undefined), { code: 'remote-url-invalid' });
  assert.throws(() => createGitRemote({ url: 'not a url', dir: '/tmp/x' }), {
    code: 'remote-url-invalid',
  });
});

test('on Windows, a drive or UNC path is a local repository; elsewhere it is refused', () => {
  const ok = [
    'C:\\Users\\o\\stores\\store.git',
    'C:\\Users\\JANE~1.DOE\\AppData\\Local\\Temp\\store.git',
    'C:\\Users\\Jane Doe\\stores\\store.git',
    'd:/stores/store.git',
    'file://C:\\stores\\store.git',
    'file:///C:/stores/store.git',
    '\\\\server\\share\\store.git',
  ];
  for (const url of ok) {
    assert.equal(checkRemoteUrl(url, 'win32'), url);
    if (/[\\ ]/.test(url)) {
      assert.throws(() => checkRemoteUrl(url, 'linux'), { code: 'remote-url-invalid' }, url);
    }
  }
  const bad = [
    'C:',
    'C:\\',
    'C:store.git',
    'C:\\stores\\store.git\nx',
    'C:\\stores\\a|b.git',
    'C:\\stores\\a"b.git',
    'C:\\stores\\a:b.git',
    'C:\\stores\\a?b.git',
    '\\\\server',
    '\\\\server\\',
    '\\\\?\\C:\\stores\\store.git',
    'file://\\\\server\\share\\store.git',
    'https://github.com\\owner\\store.git',
    'https://github.com/owner/store.git extra',
  ];
  for (const url of bad) {
    assert.throws(
      () => checkRemoteUrl(url, 'win32'),
      { code: 'remote-url-invalid' },
      `${JSON.stringify(url)} should be refused`,
    );
  }
});

test('the local directory must be a store directory, never a checkout', () => {
  const dir = tempDir('hitld-remote-dir-');
  try {
    const url = 'file:///nowhere.git';
    assert.throws(() => createGitRemote({ url, dir: 'relative/dir' }), {
      code: 'remote-dir-invalid',
    });
    mkdirSync(join(dir, '.git'));
    assert.throws(() => createGitRemote({ url, dir }), { code: 'remote-dir-invalid' });
    const other = join(dir, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'notes.txt'), 'x');
    assert.throws(() => createGitRemote({ url, dir: other }), { code: 'remote-dir-invalid' });
    assert.throws(() => createGitRemote({ url, dir: join(dir, 'ok'), branch: '--x' }), {
      code: 'remote-argument-invalid',
    });
    // On Windows the path resolves onto the current drive, with its own separators.
    assert.equal(remoteDir('/s/store'), resolve('/s/store/.git/hitld-remote'));
    if (process.platform !== 'win32') {
      assert.equal(remoteDir('/s/store'), '/s/store/.git/hitld-remote');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreachable remote is named, not mistaken for an empty one', async () => {
  const host = fakeHost();
  try {
    const r = host.open('file:///nonexistent/store.git');
    await assert.rejects(r.head(), { code: 'remote-unreachable' });
    await assert.rejects(r.push(Buffer.from('a'), { expected: null }), {
      code: 'remote-unreachable',
    });
  } finally {
    host.cleanup();
  }
});

test('each bundle is one file on a branch, holding exactly the bytes pushed', async () => {
  const host = fakeHost();
  try {
    const r = host.open();
    const bytes = Buffer.from('opaque \x00\xff bytes');
    const a = await r.push(bytes, { expected: null });
    const b = await r.push(Buffer.from('second'), { expected: a });
    assert.match(a, /^00000001-[0-9a-f]{64}$/);
    assert.match(b, /^00000002-[0-9a-f]{64}$/);
    assert.equal(a.slice(9), createHash('sha256').update(bytes).digest('hex'));
    const files = gitIn(host.bare, ['ls-tree', '-r', '--name-only', STORE_BRANCH]).split('\n');
    assert.deepEqual(files, [`bundles/${a}.bundle`, `bundles/${b}.bundle`]);
    assert.equal(gitIn(host.bare, ['rev-list', '--count', STORE_BRANCH]), '2');
    assert.equal(
      gitIn(host.bare, ['for-each-ref', '--format=%(refname)']),
      `refs/heads/${STORE_BRANCH}`,
    );
  } finally {
    host.cleanup();
  }
});

test('prune replaces the branch with one root commit and keeps the head id', async () => {
  const host = fakeHost();
  try {
    const r = host.open();
    /** @type {string | null} */
    let head = null;
    for (let i = 0; i < 4; i++) head = await r.push(Buffer.from(`b${i}`), { expected: head });
    assert.equal(gitIn(host.bare, ['rev-list', '--count', STORE_BRANCH]), '4');
    const { kept, removed } = await r.prune({ keep: 2 });
    assert.equal(kept.length, 2);
    assert.equal(removed.length, 2);
    assert.equal(kept[1], head);
    assert.equal(gitIn(host.bare, ['rev-list', '--count', STORE_BRANCH]), '1');
    const left = gitIn(host.bare, ['ls-tree', '-r', '--name-only', STORE_BRANCH]).split('\n');
    assert.equal(left.length, 2);
    // Sequence numbers go on from the head, not from the number of files left.
    const next = await r.push(Buffer.from('b4'), { expected: head });
    assert.match(next, /^00000005-/);
  } finally {
    host.cleanup();
  }
});

test('a prune does not overwrite a push that lands while it runs', async () => {
  const host = fakeHost();
  try {
    const [a, b] = [host.open(), host.open()];
    /** @type {string | null} */
    let head = null;
    for (let i = 0; i < 3; i++) head = await a.push(Buffer.from(`b${i}`), { expected: head });
    // Race the two for real: whichever order they land in, nothing pushed is lost.
    const [pruned, pushed] = await Promise.allSettled([
      b.prune({ keep: 1 }),
      a.push(Buffer.from('late'), { expected: head }),
    ]);
    assert.equal(pruned.status, 'fulfilled');
    assert.equal(pushed.status, 'fulfilled');
    const final = await host.open().head();
    assert.equal(final, /** @type {PromiseFulfilledResult<string>} */ (pushed).value);
    assert.ok((await host.open().fetch(/** @type {string} */ (final))).equals(Buffer.from('late')));
  } finally {
    host.cleanup();
  }
});

test('a bundle that does not match its name is refused as corrupt', async () => {
  const host = fakeHost();
  try {
    const r = host.open();
    const id = `00000001-${createHash('sha256').update('good').digest('hex')}`;
    const blob = gitIn(host.bare, ['hash-object', '-w', '--stdin'], 'evil');
    const sub = gitIn(host.bare, ['mktree'], `100644 blob ${blob}\t${id}.bundle\n`);
    const root = gitIn(host.bare, ['mktree'], `040000 tree ${sub}\tbundles\n`);
    const commit = gitIn(host.bare, ['commit-tree', root, '-m', 'tampered']);
    gitIn(host.bare, ['update-ref', `refs/heads/${STORE_BRANCH}`, commit]);
    assert.equal(await r.head(), id);
    await assert.rejects(r.fetch(id), { code: 'remote-corrupt' });
  } finally {
    host.cleanup();
  }
});

test('bad arguments are named', async () => {
  const host = fakeHost();
  try {
    const r = host.open();
    await assert.rejects(r.fetch('../../etc/passwd'), { code: 'remote-version-invalid' });
    await assert.rejects(r.fetch(/** @type {any} */ (undefined)), {
      code: 'remote-version-invalid',
    });
    await assert.rejects(r.push(Buffer.alloc(0), { expected: null }), {
      code: 'remote-argument-invalid',
    });
    await assert.rejects(r.push(/** @type {any} */ ('text'), { expected: null }), {
      code: 'remote-argument-invalid',
    });
    await assert.rejects(r.push(Buffer.from('a'), { expected: 'nope' }), {
      code: 'remote-version-invalid',
    });
    await assert.rejects(r.push(Buffer.alloc(MAX_BUNDLE_BYTES + 1), { expected: null }), {
      code: 'remote-too-large',
    });
    assert.equal(await r.head(), null);
  } finally {
    host.cleanup();
  }
});

test('a refusal that is not a race is reported, not taken for a stale head', async () => {
  const host = fakeHost();
  try {
    const r = host.open();
    const a = await r.push(Buffer.from('a'), { expected: null });
    // The host refuses every update (a protected branch, say).
    const hook = join(host.bare, 'hooks', 'update');
    mkdirSync(join(host.bare, 'hooks'), { recursive: true });
    writeFileSync(hook, '#!/bin/sh\necho "branch is protected" >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    await assert.rejects(r.push(Buffer.from('b'), { expected: a }), (e) => {
      assert.ok(e instanceof StoreRemoteError);
      assert.equal(e.code, 'remote-git-failed');
      assert.match(e.message, /protected/);
      return true;
    });
    await assert.rejects(r.push(Buffer.from('c'), { expected: a }), {
      code: 'remote-git-failed',
    });
    assert.equal(await r.head(), a);
  } finally {
    host.cleanup();
  }
});

test('git runs with hooks off, and only connection config crosses from the owner', async () => {
  const host = fakeHost();
  const home = tempDir('hitld-remote-home-');
  const marker = join(home, 'hook-ran');
  // A Windows path in a shell script: forward slashes, so sh does not read escapes in it.
  const touch = `#!/bin/sh\ntouch '${marker.replaceAll('\\', '/')}'\n`;
  // A git config file escapes a backslash (a Windows path's) in a name or a value.
  const cfg = (/** @type {string} */ s) => s.replaceAll('\\', '\\\\');
  const saved = { ...process.env };
  try {
    // A hooks directory named in the owner's config: nothing in it runs.
    const hooks = join(home, 'hooks');
    mkdirSync(hooks);
    for (const name of ['pre-push', 'reference-transaction']) {
      writeFileSync(join(hooks, name), touch);
      chmodSync(join(hooks, name), 0o755);
    }
    // A connection key (url rewriting) crosses; a hooks path and an ssh command do not.
    writeFileSync(
      join(home, '.gitconfig'),
      [
        `[url "${cfg(host.url)}"]`,
        '\tinsteadOf = https://git.example.test/owner/store.git',
        '[core]',
        `\thooksPath = ${cfg(hooks)}`,
        `\tsshCommand = ${cfg(`touch '${marker.replaceAll('\\', '/')}'`)}`,
      ].join('\n') + '\n',
    );
    process.env.HOME = home;
    // The owner's global config is the one in their home, as plain git finds it.
    delete process.env.GIT_CONFIG_GLOBAL;
    delete process.env.GIT_CONFIG_COUNT;
    const dir = join(home, 'store', 'remote');
    const r = createGitRemote({ url: 'https://git.example.test/owner/store.git', dir });
    const a = await r.push(Buffer.from('through the rewritten url'), { expected: null });
    assert.equal(await host.open().head(), a, 'the url rewrite from the owner config applied');
    assert.equal(existsSync(marker), false, 'no hook or ssh command from the config ran');
    // A hook placed in the local copy itself does not run either.
    mkdirSync(join(dir, 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'hooks', 'pre-push'), touch);
    chmodSync(join(dir, 'hooks', 'pre-push'), 0o755);
    await r.push(Buffer.from('again'), { expected: a });
    assert.equal(existsSync(marker), false);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    rmSync(home, { recursive: true, force: true });
    host.cleanup();
  }
});

/**
 * Run `body` with the owner's environment changed by `set` (undefined deletes), then put it back.
 * @param {Record<string, string | undefined>} set @param {() => Promise<void>} body
 */
async function withEnv(set, body) {
  const saved = { ...process.env };
  try {
    for (const [k, v] of Object.entries(set)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env.GIT_CONFIG_COUNT;
    await body();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

/** A url rewrite from the test's address to the fake host: a connection key, as config text. */
const rewrite = (/** @type {string} */ url) =>
  `[url "${url.replaceAll('\\', '\\\\')}"]\n\tinsteadOf = https://git.example.test/owner/store.git\n`;

test(
  "a connection key from git's installation-level config crosses, as plain git reads it",
  { skip: process.platform === 'win32' && 'the stand-in git is a shell script' },
  async () => {
    // A git build with a config file of its own (Apple's Xcode git): every command reads it
    // unless GIT_CONFIG_NOSYSTEM is set, but `git config --system` does not. The stand-in adds
    // the file to every command the same way, through the real git.
    const host = fakeHost();
    const home = tempDir('hitld-remote-home-');
    try {
      const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
      assert.ok(real, 'git is on PATH');
      const builtIn = join(home, 'built-in-gitconfig');
      writeFileSync(builtIn, rewrite(host.url));
      const bin = join(home, 'bin');
      mkdirSync(bin);
      writeFileSync(
        join(bin, 'git'),
        [
          '#!/bin/sh',
          'if [ -z "$GIT_CONFIG_NOSYSTEM" ]; then',
          `  exec '${real}' -c 'include.path=${builtIn}' "$@"`,
          'fi',
          `exec '${real}' "$@"`,
        ].join('\n') + '\n',
      );
      chmodSync(join(bin, 'git'), 0o755);
      const owner = {
        HOME: home,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        GIT_CONFIG_NOSYSTEM: undefined,
        GIT_CONFIG_GLOBAL: undefined,
      };
      await withEnv(owner, async () => {
        const plain = spawnSync('git', ['config', '--get-regexp', '^url\\.'], {
          cwd: home,
          encoding: 'utf8',
        });
        assert.equal(plain.status, 0, 'plain git reads the built-in config');
        const system = spawnSync('git', ['config', '--system', '--get-regexp', '^url\\.'], {
          cwd: home,
          encoding: 'utf8',
        });
        assert.notEqual(system.status, 0, '`git config --system` does not read it');
        const r = createGitRemote({
          url: 'https://git.example.test/owner/store.git',
          dir: join(home, 'store', 'remote'),
        });
        const a = await r.push(Buffer.from('through the built-in rewrite'), { expected: null });
        assert.equal(await host.open().head(), a, 'the rewrite from the built-in config applied');
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
      host.cleanup();
    }
  },
);

test('a connection key from a global config under XDG_CONFIG_HOME crosses', async () => {
  const host = fakeHost();
  const home = tempDir('hitld-remote-home-');
  try {
    const xdg = join(home, 'elsewhere');
    mkdirSync(join(xdg, 'git'), { recursive: true });
    writeFileSync(join(xdg, 'git', 'config'), rewrite(host.url));
    await withEnv({ HOME: home, XDG_CONFIG_HOME: xdg, GIT_CONFIG_GLOBAL: undefined }, async () => {
      const r = createGitRemote({
        url: 'https://git.example.test/owner/store.git',
        dir: join(home, 'store', 'remote'),
      });
      const a = await r.push(Buffer.from('through the xdg rewrite'), { expected: null });
      assert.equal(await host.open().head(), a, 'the rewrite from the XDG config applied');
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
    host.cleanup();
  }
});

test('the remote never touches the checkout it is run from', async () => {
  const host = fakeHost();
  const cwd = process.cwd();
  const work = tempDir('hitld-remote-cwd-');
  try {
    spawnSync('git', ['init', '-q', work]);
    process.chdir(work);
    const r = host.open();
    await r.push(Buffer.from('a'), { expected: null });
    const status = spawnSync('git', ['status', '--porcelain', '--ignored'], {
      cwd: work,
      encoding: 'utf8',
    });
    assert.equal(status.stdout, '', 'the checkout we ran from is untouched');
    const refs = spawnSync('git', ['for-each-ref'], { cwd: work, encoding: 'utf8' });
    assert.equal(refs.stdout, '');
  } finally {
    process.chdir(cwd);
    rmSync(work, { recursive: true, force: true });
    host.cleanup();
  }
});
