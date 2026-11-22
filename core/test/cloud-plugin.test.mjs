// A cloud session does not install the plugins a repository's settings turn on, but it runs the
// hooks in its .claude/settings.json (HITLD-792). This repository's settings run the plugin's own
// hooks there, from a copy scripts/cloud-plugin-start.mjs makes outside the checkout, and only in
// the cloud. These tests keep the settings matched to the plugin's hooks.json and show the guard
// denying an executor's push to main through them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmp.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SETTINGS = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'));
const PLUGIN_HOOKS = JSON.parse(
  readFileSync(join(ROOT, 'plugins', 'human-in-the-lead', 'hooks', 'hooks.json'), 'utf8'),
);
const GATE = '[ "$CLAUDE_CODE_REMOTE" = true ] || exit 0; ';

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

/** A repository on `main` and a claim branch, as executor-checkout.test.mjs builds it. */
function claimRepo() {
  const root = realpathSync(tempDir('hitld-792-'));
  git(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, 'work/items'), { recursive: true });
  writeFileSync(join(root, 'work/items/W-1.md'), '---\nid: W-1\nstate: planned\n---\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'start');
  git(root, 'switch', '-q', '-c', 'hitld/W-1-fix');
  writeFileSync(join(root, 'work/items/W-1.md'), '---\nid: W-1\nstate: in-progress\n---\n');
  git(
    root,
    'commit',
    '-q',
    '-am',
    'claim: W-1',
    '-m',
    'Work-Item: W-1\nDispatch: D-01KAH2Q7RS4XV9TB',
  );
  return root;
}

/**
 * Run a settings hook command as Claude Code does, through the shell.
 * @param {string} command @param {Record<string, any>} input @param {Record<string, string>} env
 */
const run = (command, input, env) =>
  spawnSync('sh', ['-c', command], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    cwd: typeof input.cwd === 'string' ? input.cwd : ROOT,
    env: { PATH: process.env.PATH ?? '', ...env },
  });

/** @param {any} spec @param {string} event @returns {{ matcher?: string, command: string, timeout?: number }[]} */
const commands = (spec, event) =>
  (spec.hooks?.[event] ?? []).flatMap((/** @type {any} */ g) =>
    (g.hooks ?? []).map((/** @type {any} */ h) => ({
      matcher: g.matcher,
      command: h.command,
      timeout: h.timeout,
    })),
  );

test('the settings run every plugin hook, from the copy, for the same events and matchers', () => {
  assert.deepEqual(Object.keys(SETTINGS.hooks).sort(), Object.keys(PLUGIN_HOOKS.hooks).sort());
  // No plugin is declared: a cloud session would not install it, and locally it is installed.
  assert.equal(SETTINGS.enabledPlugins, undefined);
  for (const event of Object.keys(PLUGIN_HOOKS.hooks)) {
    const ours = commands(SETTINGS, event);
    for (const c of ours) assert.ok(c.command.startsWith(GATE), `${event}: cloud only`);
    if (event === 'SessionStart') {
      assert.equal(ours.length, 1);
      assert.match(ours[0].command, /scripts\/cloud-plugin-start\.mjs"$/);
      continue;
    }
    const theirs = commands(PLUGIN_HOOKS, event);
    assert.equal(ours.length, theirs.length, event);
    theirs.forEach((t, i) => {
      const script = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"(.*)$/.exec(t.command);
      assert.ok(script, t.command);
      assert.ok(
        ours[i].command.endsWith(`exec node "$p/${script[1]}"${script[2]}`),
        `${event}: ${ours[i].command}`,
      );
      assert.equal(ours[i].matcher, t.matcher, event);
      assert.equal(ours[i].timeout, t.timeout, event);
      // A missing copy refuses a tool call, and only a tool call: a refused Stop would never end.
      assert.ok(ours[i].command.includes(`exit ${event === 'PreToolUse' ? 2 : 1};`), event);
    });
  }
});

test('outside the cloud every settings hook does nothing', () => {
  const home = realpathSync(tempDir('hitld-792-home-'));
  const repo = claimRepo();
  for (const event of Object.keys(SETTINGS.hooks)) {
    for (const { command } of commands(SETTINGS, event)) {
      const out = run(
        command,
        { cwd: repo, tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
        { HOME: home, CLAUDE_PROJECT_DIR: ROOT },
      );
      assert.deepEqual([out.status, out.stdout, out.stderr], [0, '', ''], event);
    }
  }
  assert.equal(existsSync(join(home, '.claude')), false);
});

test('in the cloud the guard runs from the copy and denies an executor pushing main', () => {
  const home = realpathSync(tempDir('hitld-792-home-'));
  const repo = claimRepo();
  const env = { HOME: home, CLAUDE_CODE_REMOTE: 'true', CLAUDE_PROJECT_DIR: ROOT };
  const [guard] = commands(SETTINGS, 'PreToolUse');
  const decide = (/** @type {string} */ command) => {
    const out = run(guard.command, { cwd: repo, tool_name: 'Bash', tool_input: { command } }, env);
    assert.equal(out.status, 0, out.stderr);
    return out.stdout ? JSON.parse(out.stdout).hookSpecificOutput.permissionDecision : '';
  };
  // The session started before the settings reached it, so there is no copy: the hook makes it.
  assert.equal(decide('git push origin main'), 'deny');
  const copy = join(home, '.claude', 'human-in-the-lead-cloud');
  assert.ok(existsSync(join(copy, 'hooks', 'hooks.json')));
  assert.equal(decide('git push --dry-run origin main'), 'deny');
  assert.equal(decide('npm test'), '');

  // The session start makes the copy afresh and runs the plugin's SessionStart hooks from it.
  const [start] = commands(SETTINGS, 'SessionStart');
  const out = run(start.command, { cwd: ROOT, source: 'startup' }, env);
  assert.equal(out.status, 0, out.stderr);
  assert.match(
    out.stdout,
    new RegExp(`loaded from ${copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
});

test('in the cloud, with no copy and none to be made, the guard refuses the tool call', () => {
  const home = realpathSync(tempDir('hitld-792-home-'));
  const notACheckout = realpathSync(tempDir('hitld-792-empty-'));
  const env = { HOME: home, CLAUDE_CODE_REMOTE: 'true', CLAUDE_PROJECT_DIR: notACheckout };
  const [guard] = commands(SETTINGS, 'PreToolUse');
  const out = run(guard.command, { cwd: notACheckout, tool_name: 'Read' }, env);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /no copy of the plugin/);
  for (const event of ['PostToolUse', 'Stop']) {
    const [c] = commands(SETTINGS, event);
    assert.equal(run(c.command, { cwd: notACheckout }, env).status, 1, event);
  }
});
