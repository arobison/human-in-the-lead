// `hitld install` (design parts 16.3 and 16.6): set up a consuming project.
//
//   .human-in-the-lead/policy.json  from templates/policy.json, with the project's ID and key
//   AGENTS.md                       the executor contract block, through piece (d)'s installBlock
//   CLAUDE.md                       an `@AGENTS.md` import, if the file exists without one
//   .claude/settings.json           the marketplace and the enabled plugin: a local directory
//                                   marketplace pinned to a checkout path (development, before
//                                   tags), or the GitHub marketplace pinned to a ref
//   .claude/settings.local.json     the status-line usage capture, so the quota gate has readings
//   (the plugin's hooks)            enabling the plugin turns on its SessionStart hook, which pulls
//                                   the private store from its remote, and its SessionEnd hook,
//                                   which pushes it (design 0003, section 8); both do nothing
//                                   until a store remote is configured
//   .git/hooks/pre-commit           the commit guard (design part 10.3): runs this hitld's
//                                   `check classification --staged`; shared by every worktree
//
// Nothing outside the markers of AGENTS.md is changed, an existing policy.json is kept, and
// existing settings are merged key by key. A pre-commit hook that is not hitld's is left alone,
// and the result says what to add to it. Executors never run install.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY_PATH, findRepoRoot, loadPolicy } from '../policy/policy.mjs';
import { importsAgents, installBlock } from '../contract/block.mjs';

export const MARKETPLACE = 'human-in-the-lead';
export const PLUGIN = 'human-in-the-lead';
const TEMPLATE = fileURLToPath(new URL('../../../templates/policy.json', import.meta.url));
const STATUSLINE = fileURLToPath(new URL('../../bin/hitld-statusline.mjs', import.meta.url));
const HITLD = fileURLToPath(new URL('../../bin/hitld.mjs', import.meta.url));

/** The line that marks a pre-commit hook as hitld's own, so install may rewrite it. */
export const HOOK_MARK = '# hitld:commit-guard';

/** The checkout this code runs from: the nearest directory above it with a marketplace file. */
export function ownCheckout() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, '.claude-plugin', 'marketplace.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** @param {string} path @returns {Record<string, any>} */
function readJson(path) {
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return data;
}

/** @param {string} path @param {unknown} data */
function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

/** Quote a path for a POSIX shell. @param {string} s */
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/**
 * The pre-commit hook's text. It runs the hitld at `hitld` (the one that ran install) and nothing
 * else: no command in it comes from the repository's data.
 * @param {string} hitld an absolute path to hitld.mjs
 */
export function hookScript(hitld) {
  return [
    '#!/bin/sh',
    `${HOOK_MARK} v1. Written by hitld install, which rewrites it; edit a copy under another name.`,
    "# Refuses a commit that adds a file above the repository's classification ceiling (design",
    '# part 10.3). The merge checks the same rule, so skipping this hook does not get a file to main.',
    `HITLD=${shq(hitld)}`,
    'if [ ! -f "$HITLD" ]; then',
    '  echo "hitld commit guard: $HITLD is gone; run hitld install again to point this hook at the hitld you use" >&2',
    '  exit 1',
    'fi',
    'exec node "$HITLD" check classification --staged',
    '',
  ].join('\n');
}

/**
 * Install the commit guard as the repository's pre-commit hook, in the hooks directory every
 * worktree shares. A hook that is not hitld's, or a core.hooksPath the project set, is left alone.
 * @param {string} root
 * @returns {{ done: string, warning?: string }}
 */
function installHook(root) {
  const line = `node ${shq(HITLD)} check classification --staged`;
  const hooksPath = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (hooksPath.status === 0 && hooksPath.stdout.trim()) {
    return {
      done: 'not installed (core.hooksPath is set)',
      warning: `core.hooksPath is ${hooksPath.stdout.trim()}, so hitld leaves hooks to that setup: have its pre-commit hook run ${line} and stop the commit when it fails`,
    };
  }
  const common = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (common.status !== 0) {
    return {
      done: 'not installed',
      warning: `cannot find the git directory: ${common.stderr.trim()}`,
    };
  }
  const dir = common.stdout.trim();
  const hook = join(isAbsolute(dir) ? dir : resolve(root, dir), 'hooks', 'pre-commit');
  const text = hookScript(HITLD);
  /** @type {import('node:fs').Stats | null} */
  let st = null;
  try {
    st = lstatSync(hook);
  } catch {
    st = null;
  }
  if (st) {
    const current = st.isFile() ? readFileSync(hook, 'utf8') : '';
    if (!current.includes(HOOK_MARK)) {
      return {
        done: 'not installed (a pre-commit hook exists)',
        warning: `${hook} exists and is not hitld's, so it is left as it is: add a line to it that runs ${line} and stops the commit when it fails`,
      };
    }
    if (current === text) return { done: 'unchanged' };
  }
  mkdirSync(dirname(hook), { recursive: true });
  // Trust boundary: the hook's text is fixed here, and the one path in it is this checkout's own
  // hitld.mjs (from import.meta.url), shell-quoted; nothing comes from the repository or input.
  writeFileSync(hook, text, st ? {} : { flag: 'wx' });
  chmodSync(hook, 0o755);
  return { done: st ? 'updated' : 'installed' };
}

/**
 * @param {Record<string, unknown>} input
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} ctx
 * @returns {{ ok: boolean } & Record<string, unknown>}
 */
export function install(input, ctx) {
  // install writes the project's settings and a git hook every worktree shares: never an
  // executor's to run (the plugin's guard denies it too; this is the second line).
  if (ctx.env.HITLD_ROLE === 'executor' || ctx.env.HITLD_DISPATCH) {
    return {
      ok: false,
      error: 'not-permitted',
      message:
        'hitld install changes project settings and the git hooks every worktree shares; executors never run it (HITLD_ROLE=executor or HITLD_DISPATCH is set)',
    };
  }
  const root = findRepoRoot(ctx.cwd);
  if (!root)
    return {
      ok: false,
      error: 'not-a-repository',
      message: `${ctx.cwd} is not in a git repository`,
    };
  /** @type {Record<string, string>} */
  const done = {};
  /** @type {string[]} */
  const warnings = [];

  // policy.json
  const policyPath = join(root, POLICY_PATH);
  if (existsSync(policyPath)) {
    done.policy = 'kept';
  } else {
    const key = typeof input.key === 'string' ? input.key : null;
    if (!key)
      return {
        ok: false,
        error: 'usage',
        message: 'no policy.json yet: give --key (the tracker ID key, such as W)',
      };
    const id =
      typeof input['project-id'] === 'string'
        ? input['project-id']
        : basename(root)
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^[^a-z0-9]+/, '')
            .slice(0, 64) || 'project';
    const policy = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
    policy.project = { ...policy.project, id, key };
    writeJson(policyPath, policy);
    done.policy = 'created';
  }

  // The contract block, and CLAUDE.md's import of it.
  const block = installBlock(root, undefined, loadPolicy({ cwd: root }).policy?.project?.key);
  if (!block.ok) return { ok: false, error: 'contract', message: block.message, done };
  done.agents_md = block.action;
  const claude = join(root, 'CLAUDE.md');
  if (existsSync(claude)) {
    const text = readFileSync(claude, 'utf8');
    if (importsAgents(text)) done.claude_md = 'imports';
    else {
      writeFileSync(claude, text.replace(/\n*$/, '\n\n') + '@AGENTS.md\n');
      done.claude_md = 'import added';
    }
  } else {
    done.claude_md = 'absent';
  }

  // The marketplace and the plugin, in committed project settings.
  /** @type {Record<string, unknown>} */
  let source;
  if (typeof input.ref === 'string') {
    if (typeof input.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(input.repo)) {
      return { ok: false, error: 'usage', message: '--ref needs --repo owner/name', done };
    }
    source = { source: 'github', repo: input.repo, ref: input.ref };
  } else {
    const given = typeof input.marketplace === 'string' ? input.marketplace : ownCheckout();
    if (!given)
      return {
        ok: false,
        error: 'usage',
        message: 'cannot tell which checkout to serve the plugin from: give --marketplace <path>',
        done,
      };
    const path = resolve(ctx.cwd, given);
    if (!existsSync(join(path, '.claude-plugin', 'marketplace.json'))) {
      return {
        ok: false,
        error: 'usage',
        message: `${path} has no .claude-plugin/marketplace.json`,
        done,
      };
    }
    source = { source: 'directory', path };
    warnings.push(
      `.claude/settings.json now names ${path}, a path on this machine: fine for development before tags exist; switch to --ref <tag> --repo <owner/name> before others clone the project`,
    );
  }
  const settingsPath = join(root, '.claude', 'settings.json');
  const settings = readJson(settingsPath);
  settings.extraKnownMarketplaces = {
    ...(settings.extraKnownMarketplaces ?? {}),
    [MARKETPLACE]: { source },
  };
  settings.enabledPlugins = {
    ...(settings.enabledPlugins ?? {}),
    [`${PLUGIN}@${MARKETPLACE}`]: true,
  };
  writeJson(settingsPath, settings);
  done.settings = '.claude/settings.json';
  done.store_sync_hooks =
    'the plugin carries them: SessionStart pulls the private store, SessionEnd pushes it; both do nothing until store.remote.url is set';

  // The usage capture is opt-in (--statusline). The default quotas are the subscription
  // windows, read only from the status line, and a quota with no reading stops dispatch.
  // --no-statusline is accepted and does nothing, because off is the default.
  if (input.statusline !== true || input['no-statusline'] === true) {
    done.statusline = 'skipped';
    warnings.push(
      'without the status-line capture the default quotas have no readings, so dispatch stops at the gate; add --statusline to install it',
    );
  } else {
    const localPath = join(root, '.claude', 'settings.local.json');
    const local = readJson(localPath);
    if (local.statusLine) {
      done.statusline = 'kept (settings.local.json already has a status line)';
      warnings.push(
        'settings.local.json already sets a status line: have it pipe its input to hitld-statusline too, or the quota gate has no readings',
      );
    } else {
      local.statusLine = { type: 'command', command: `node ${shq(STATUSLINE)}` };
      writeJson(localPath, local);
      done.statusline = '.claude/settings.local.json';
    }
    const ignore = join(root, '.gitignore');
    const text = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
    // Already ignored (by .gitignore, a global ignore or .git/info/exclude): leave .gitignore be.
    const ignored =
      spawnSync('git', ['check-ignore', '-q', '.claude/settings.local.json'], { cwd: root })
        .status === 0;
    if (!ignored && !/^\.claude\/settings\.local\.json$/m.test(text)) {
      writeFileSync(
        ignore,
        (text && !text.endsWith('\n') ? `${text}\n` : text) + '.claude/settings.local.json\n',
      );
    }
  }

  // The commit guard.
  const hook = installHook(root);
  done.commit_guard = hook.done;
  if (hook.warning) warnings.push(hook.warning);

  const add =
    source.source === 'directory'
      ? `claude plugin marketplace add ${shq(String(source.path))}`
      : null;
  return {
    ok: true,
    root,
    done,
    warnings,
    next: [
      ...(add ? [add] : []),
      `claude plugin install ${PLUGIN}@${MARKETPLACE} --scope project`,
      'set merge.full_suite (and merge.fast_checks) in .human-in-the-lead/policy.json: the merge queue will not move main without a full suite',
      'hitld check contract && hitld check policy',
      'commit AGENTS.md, CLAUDE.md, .claude/settings.json and .human-in-the-lead/policy.json',
    ],
  };
}
