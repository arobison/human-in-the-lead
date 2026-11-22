#!/usr/bin/env node
// SessionStart in this repository's cloud sessions (HITLD-792). A cloud session does not install
// the plugins a repository's .claude/settings.json turns on, but it does run that file's hooks, so
// the committed settings run the plugin's own hooks instead. This step copies the plugin as it
// stands at HEAD to a directory outside the checkout, so that a later edit to the checkout (an
// executor's own branch) cannot change the guard that is running, as an installed plugin's cached
// copy cannot be changed by one. Then it runs the plugin's SessionStart hooks from that copy.
// Every other event's hook in .claude/settings.json runs the copy; when the copy is missing (the
// settings arrived after the session started) it makes it with `--copy` first, and when that fails
// the PreToolUse hook refuses the tool call, so the guard fails closed
// (core/test/cloud-plugin.test.mjs keeps the settings matched to the plugin's hooks.json).
//
// Outside the cloud (CLAUDE_CODE_REMOTE is not "true") it does nothing: a local session loads the
// installed plugin, and running both would run every hook twice.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the copy goes; the hooks in .claude/settings.json read the same path. */
export const COPY = join(homedir(), '.claude', 'human-in-the-lead-cloud');
const PLUGIN = 'plugins/human-in-the-lead';

/** @param {string} root the checkout @returns {string | null} why the copy failed, or null */
function copyPlugin(root) {
  const tmp = `${COPY}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  // `git archive HEAD` takes the committed plugin, so an uncommitted edit is not copied either.
  const archive = spawnSync('git', ['archive', '--format=tar', 'HEAD', PLUGIN], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (archive.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    return `git archive failed: ${String(archive.stderr).trim()}`;
  }
  const strip = PLUGIN.split('/').length;
  const tar = spawnSync('tar', ['-x', '-f', '-', '-C', tmp, `--strip-components=${strip}`], {
    input: archive.stdout,
  });
  if (tar.status !== 0 || !existsSync(join(tmp, 'hooks', 'hooks.json'))) {
    rmSync(tmp, { recursive: true, force: true });
    return `unpacking the plugin failed: ${String(tar.stderr).trim()}`;
  }
  rmSync(COPY, { recursive: true, force: true });
  renameSync(tmp, COPY);
  return null;
}

/**
 * Run the copy's SessionStart hooks one after another, each with the hook input on stdin and
 * CLAUDE_PLUGIN_ROOT set to the copy, as Claude Code runs a plugin's; their output is this hook's.
 * @param {string} input
 */
function runSessionStart(input) {
  /** @type {{ hooks?: { SessionStart?: { hooks?: { command?: string, timeout?: number }[] }[] } }} */
  const spec = JSON.parse(readFileSync(join(COPY, 'hooks', 'hooks.json'), 'utf8'));
  for (const group of spec.hooks?.SessionStart ?? []) {
    for (const h of group.hooks ?? []) {
      if (typeof h.command !== 'string') continue;
      const out = spawnSync('sh', ['-c', h.command], {
        input,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: COPY },
        timeout: (h.timeout ?? 60) * 1000,
      });
      if (out.stdout) process.stdout.write(out.stdout);
      if (out.stderr) process.stderr.write(out.stderr);
    }
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  if (process.env.CLAUDE_CODE_REMOTE === 'true') {
    const root =
      process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..');
    if (process.argv[2] === '--copy') {
      // Another event's hook found no copy: the settings reached a session that started before
      // they did (a pull or a checkout), so make the copy now rather than refuse every tool call.
      if (!existsSync(join(COPY, 'hooks', 'hooks.json'))) {
        const failed = copyPlugin(root);
        if (failed) process.stderr.write(`human-in-the-lead: ${failed}\n`);
      }
    } else {
      const input = (() => {
        try {
          return readFileSync(0, 'utf8');
        } catch {
          return '';
        }
      })();
      const failed = copyPlugin(root);
      if (failed) {
        // The other hooks try once more each time, and refuse the tool call when they cannot.
        process.stdout.write(
          `human-in-the-lead: the plugin could not be copied for this cloud session (${failed}), so its hooks refuse every tool call.\n`,
        );
      } else {
        runSessionStart(input);
      }
    }
  }
}
