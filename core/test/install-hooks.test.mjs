// The commit guard hooks find hitld when they run (HITLD-741): on PATH, then the pinned plugin in
// Claude Code's plugin cache, then the path recorded at install. A version other than the pin is
// reported; no hitld at all warns and lets the commit through, since the merge checks it anyway.
//
// Each test runs the hook text install writes, under sh, with a PATH, a Claude Code config
// directory and a recorded path it controls, and stand-in hitlds that log which one ran.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookScript, messageHookScript } from '../lib/install/install.mjs';
import { VERSION } from '../lib/version.mjs';
import { git, makeConsumer, put } from './orchestrator-fixture.mjs';
import { tempDir } from './helpers/tmp.mjs';

const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));
const posix = process.platform !== 'win32';
const skip = posix
  ? false
  : 'the hooks run under POSIX sh and the test links node by a symbolic link';
const PIN = '1.2.3';

/**
 * A stand-in hitld: `version` prints the given version; anything else logs the label and its
 * arguments, and exits with `code`.
 * @param {string} file @param {{ label: string, version: string, log: string, code?: number }} o
 */
function fake(file, o) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      `#!${process.execPath}`,
      "const fs = process.getBuiltinModule('node:fs');",
      'const a = process.argv.slice(2);',
      `if (a[0] === 'version') { console.log(JSON.stringify({ ok: true, version: ${JSON.stringify(o.version)} }, null, 2)); process.exit(0); }`,
      `fs.appendFileSync(${JSON.stringify(o.log)}, ${JSON.stringify(o.label)} + ' ' + a.join(' ') + '\\n');`,
      `process.exit(${o.code ?? 0});`,
      '',
    ].join('\n'),
  );
  chmodSync(file, 0o755);
  return file;
}

/**
 * A project directory pinning `pin`, a PATH with only node (and hitld when asked), a config
 * directory, and a recorded path.
 * @param {{ settings?: unknown }} [o]
 */
function setup(o = {}) {
  const base = tempDir('hitld-hooks-');
  const project = join(base, 'project');
  const settings = o.settings ?? {
    extraKnownMarketplaces: {
      'human-in-the-lead': { source: { source: 'github', repo: 'o/r', ref: `v${PIN}` } },
    },
  };
  mkdirSync(join(project, '.claude'), { recursive: true });
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify(settings));
  const bin = join(base, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  const log = join(base, 'log');
  const config = join(base, 'claude');
  const cached = (/** @type {string} */ v) =>
    join(config, 'plugins', 'cache', 'human-in-the-lead', 'human-in-the-lead', v, 'core', 'bin');
  const recorded = join(base, 'checkout', 'core', 'bin', 'hitld.mjs');
  /**
   * Run a hook in the project.
   * @param {string} text the hook @param {string[]} [args] @param {{ path?: string }} [r]
   */
  const run = (text, args = [], r = {}) => {
    const hook = join(base, 'hook');
    writeFileSync(hook, text, { mode: 0o755 });
    const p = spawnSync('/bin/sh', [hook, ...args], {
      cwd: project,
      encoding: 'utf8',
      env: { PATH: r.path ?? bin, CLAUDE_CONFIG_DIR: config, HOME: base },
    });
    const ran = existsSync(log) ? readFileSync(log, 'utf8') : '';
    if (existsSync(log)) writeFileSync(log, '');
    return { status: p.status, stderr: p.stderr, ran };
  };
  return { base, project, bin, log, config, cached, recorded, run };
}

test(
  'the hook uses hitld on PATH first, then the pinned plugin, then the recorded path',
  { skip },
  () => {
    const s = setup();
    const onPath = fake(join(s.bin, 'hitld'), { label: 'path', version: PIN, log: s.log });
    fake(join(s.cached(PIN), 'hitld.mjs'), { label: 'plugin', version: PIN, log: s.log });
    // Another cached version is not the pin, so it is never used.
    fake(join(s.cached('9.0.0'), 'hitld.mjs'), { label: 'other', version: '9.0.0', log: s.log });
    fake(s.recorded, { label: 'recorded', version: PIN, log: s.log });
    const hook = hookScript(s.recorded);

    let r = s.run(hook);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.ran, 'path check classification --staged\n');
    assert.equal(r.stderr, '');

    renameSync(onPath, join(s.base, 'off-path'));
    r = s.run(hook);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.ran, 'plugin check classification --staged\n');
    assert.equal(r.stderr, '');

    renameSync(s.cached(PIN), join(s.base, 'uncached'));
    r = s.run(hook);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.ran, 'recorded check classification --staged\n');
    assert.equal(r.stderr, '');
  },
);

test(
  'the commit-msg hook passes the message file, and a refusal still stops the commit',
  { skip },
  () => {
    const s = setup();
    fake(join(s.bin, 'hitld'), { label: 'path', version: PIN, log: s.log, code: 1 });
    const r = s.run(messageHookScript(s.recorded), ['.git/COMMIT_EDITMSG']);
    assert.equal(r.status, 1);
    assert.equal(r.ran, 'path check commit-message .git/COMMIT_EDITMSG\n');
  },
);

test(
  'a hitld whose version is not the pin is named, and the check still runs with it',
  { skip },
  () => {
    const s = setup();
    fake(join(s.bin, 'hitld'), { label: 'path', version: '0.9.0', log: s.log, code: 1 });
    const r = s.run(hookScript(s.recorded));
    assert.equal(r.status, 1, 'its refusal still stops the commit');
    assert.equal(r.ran, 'path check classification --staged\n');
    assert.match(
      r.stderr,
      /hitld commit guard: the hitld on PATH \(.*\) is version 0\.9\.0, but the project pins 1\.2\.3/,
    );
    // One whose version cannot be read is reported too.
    const t = setup();
    writeFileSync(join(t.bin, 'hitld'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.match(
      t.run(hookScript(t.recorded)).stderr,
      /of an unknown version, but the project pins 1\.2\.3/,
    );
  },
);

test("a directory pin is the version of that directory's plugin", { skip }, () => {
  const s = setup({
    settings: {
      extraKnownMarketplaces: {
        'human-in-the-lead': { source: { source: 'directory', path: CHECKOUT } },
      },
    },
  });
  fake(join(s.cached(VERSION), 'hitld.mjs'), { label: 'plugin', version: VERSION, log: s.log });
  const r = s.run(hookScript(s.recorded));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.ran, 'plugin check classification --staged\n');
});

test('a pin that is not a version names no plugin directory', { skip }, () => {
  const s = setup({
    settings: {
      extraKnownMarketplaces: {
        'human-in-the-lead': {
          source: { source: 'github', repo: 'o/r', ref: 'v1.2.3/../../../x' },
        },
      },
    },
  });
  fake(join(s.config, 'x', 'core', 'bin', 'hitld.mjs'), {
    label: 'escaped',
    version: PIN,
    log: s.log,
  });
  fake(s.recorded, { label: 'recorded', version: '0.1.0', log: s.log });
  const r = s.run(hookScript(s.recorded));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.ran, 'recorded check classification --staged\n');
  assert.equal(r.stderr, '', 'with no pin there is no version to differ from');
});

test(
  'a recorded path that no longer exists, and no other hitld, warns and lets the commit through',
  { skip },
  () => {
    const s = setup();
    for (const hook of [hookScript(s.recorded), messageHookScript(s.recorded)]) {
      const r = s.run(hook, ['.git/COMMIT_EDITMSG']);
      assert.equal(r.status, 0);
      assert.equal(r.ran, '');
      assert.match(
        r.stderr,
        /no hitld found, so this commit is not checked here \(the merge still checks it\)/,
      );
      assert.ok(r.stderr.includes(`${s.recorded} (recorded at install, now gone)`));
      assert.match(r.stderr, /the pinned plugin 1\.2\.3 in the Claude Code plugin cache/);
      assert.match(
        r.stderr,
        /put hitld on PATH, install the pinned plugin, or run hitld install again/,
      );
    }
    // Without node no hitld can run: the same pass, said so.
    const r = s.run(hookScript(s.recorded), [], { path: join(s.base, 'empty') });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /node is not on PATH, so this commit is not checked here/);
  },
);

test('a commit goes through when the checkout install recorded is gone', { skip }, () => {
  const c = makeConsumer();
  const gone = join(tempDir('hitld-gone-'), 'core', 'bin', 'hitld.mjs');
  const hooks = join(c.root, '.git', 'hooks');
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, 'pre-commit'), hookScript(gone), { mode: 0o755 });
  writeFileSync(join(hooks, 'commit-msg'), messageHookScript(gone), { mode: 0o755 });
  put(c.root, { 'notes/a.md': 'public notes\n' });
  git(c.root, 'add', '-A');
  const bin = join(tempDir('hitld-bin-'), 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  const gitBin = dirname(
    spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(),
  );
  const commit = spawnSync('git', ['commit', '-q', '-m', 'notes'], {
    cwd: c.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${gitBin}:/usr/bin:/bin`,
      CLAUDE_CONFIG_DIR: join(bin, 'none'),
    },
  });
  assert.equal(commit.status, 0, commit.stderr);
  // A hitld installed beside git on this machine would be found first; only without one is
  // there nothing to find.
  if (!existsSync(join(gitBin, 'hitld'))) {
    assert.equal((commit.stderr.match(/no hitld found/g) ?? []).length, 2, commit.stderr);
  }
});
