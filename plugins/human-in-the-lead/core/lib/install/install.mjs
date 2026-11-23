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
//   .git/hooks/pre-commit           the commit guard (design part 10.3): runs
//                                   `check classification --staged` with the hitld it finds when
//                                   it runs (HITLD-741); shared by every worktree
//   .git/hooks/commit-msg           the commit message guard (design part 10.3, rule 7): runs
//                                   `check commit-message` on the message; shared the same way
//
// Nothing outside the markers of AGENTS.md is changed, an existing policy.json is kept, and
// existing settings are merged key by key. A pre-commit or commit-msg hook that is not hitld's is
// left alone, and the result says what to add to it. Executors never run install.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY_PATH, findRepoRoot, loadPolicy } from '../policy/policy.mjs';
import { importsAgents, installBlock } from '../contract/block.mjs';
import { SCHEMA_DIR } from '../schema/registry.mjs';

export const MARKETPLACE = 'human-in-the-lead';
export const PLUGIN = 'human-in-the-lead';
const TEMPLATE = fileURLToPath(new URL('../../../templates/policy.json', import.meta.url));
const STATUSLINE = fileURLToPath(new URL('../../bin/hitld-statusline.mjs', import.meta.url));
const HITLD = fileURLToPath(new URL('../../bin/hitld.mjs', import.meta.url));

/** The tracker ID key pattern, read from the policy schema so `check policy` and install agree. */
const KEY_PATTERN = String(
  JSON.parse(readFileSync(join(SCHEMA_DIR, 'policy', 'project.schema.json'), 'utf8')).properties.key
    .pattern,
);

/** The line that marks a pre-commit or commit-msg hook as hitld's own, so install may rewrite it. */
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
 * The resolver every commit guard hook runs (HITLD-741): it finds hitld when the hook runs, not
 * when install wrote it, so a moved or removed checkout does not stop commits. In order:
 *
 *   1. `hitld` on the PATH;
 *   2. the bundled executable of the plugin version the project pins in .claude/settings.json
 *      (a `v<version>` ref, or the version of the pinned directory's plugin), in Claude Code's
 *      plugin cache under CLAUDE_CONFIG_DIR, or ~/.claude when that is unset;
 *   3. the hitld.mjs recorded at install.
 *
 * The one it finds is asked its version; a version other than the pin is reported, and the check
 * still runs with it. When none is found the hook warns, says how to fix it, and lets the commit
 * through: the merge runs the same checks, so nothing reaches main unchecked.
 *
 * Trust boundary: the text is fixed here. The repository's data only picks a version string, which
 * must look like one (no path separators), under the user's own Claude Code plugin cache; nothing
 * from the repository is run.
 * @param {string} recorded an absolute path to hitld.mjs @param {string[]} args the check to run
 */
function resolverScript(recorded, args) {
  return `const { spawnSync } = require('node:child_process');
const { readFileSync, statSync } = require('node:fs');
const { delimiter, join } = require('node:path');
const { homedir } = require('node:os');
const RECORDED = ${JSON.stringify(recorded)};
const ARGS = ${JSON.stringify(args)}.concat(process.argv.slice(2));
const PLUGIN = 'human-in-the-lead';
const win = process.platform === 'win32';
const say = (m) => process.stderr.write('hitld commit guard: ' + m + '\\n');
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
// The version .claude/settings.json pins, or null when it pins none that can be read.
const pinned = () => {
  const s = readJson(join('.claude', 'settings.json'))?.extraKnownMarketplaces?.[PLUGIN]?.source;
  let v = null;
  if (s?.source === 'github' && typeof s.ref === 'string') v = s.ref.replace(/^v/, '');
  if (s?.source === 'directory' && typeof s.path === 'string') {
    v = readJson(join(s.path, 'plugins', PLUGIN, '.claude-plugin', 'plugin.json'))?.version;
  }
  return typeof v === 'string' && /^\\d+\\.\\d+\\.\\d+([-+][0-9A-Za-z.-]+)?$/.test(v) ? v : null;
};
const onPath = () => {
  const exts = win ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').concat('') : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) if (isFile(join(dir, 'hitld' + ext))) return join(dir, 'hitld' + ext);
  }
  return null;
};
const inCache = (v) => {
  if (!v) return null;
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const p = join(config, 'plugins', 'cache', PLUGIN, PLUGIN, v, 'core', 'bin', 'hitld.mjs');
  return isFile(p) ? p : null;
};
// A file on PATH runs as it is (through cmd.exe for a .cmd shim); a hitld.mjs runs under node.
const run = (c, args, opts) => {
  if (!c.direct) return spawnSync(process.execPath, [c.file].concat(args), opts);
  if (win && /\\.(cmd|bat)$/i.test(c.file)) {
    const line = [c.file].concat(args).map((a) => '"' + a + '"').join(' ');
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + line + '"'], {
      ...opts,
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(c.file, args, opts);
};
const want = pinned();
const path = onPath();
const cached = path ? null : inCache(want);
const found = path
  ? { file: path, direct: true, from: 'on PATH' }
  : cached
    ? { file: cached, direct: false, from: 'the pinned plugin' }
    : isFile(RECORDED)
      ? { file: RECORDED, direct: false, from: 'recorded at install' }
      : null;
if (!found) {
  say(
    'no hitld found, so this commit is not checked here (the merge still checks it). Looked for ' +
      'hitld on PATH, ' +
      (want ? 'the pinned plugin ' + want + ' in the Claude Code plugin cache, ' : '') +
      'and ' + RECORDED + ' (recorded at install, now gone). To fix it, put hitld on PATH, ' +
      'install the pinned plugin, or run hitld install again from the hitld you use.',
  );
  process.exit(0);
}
if (want) {
  const r = run(found, ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let got = null;
  try {
    got = JSON.parse(r.stdout).version;
  } catch {}
  if (got !== want) {
    say(
      'the hitld ' + found.from + ' (' + found.file + ') is ' +
        (typeof got === 'string' ? 'version ' + got : 'of an unknown version') +
        ', but the project pins ' + want + '; checking with it anyway. ' +
        'Install hitld ' + want + ' to check with the pinned rules.',
    );
  }
}
const r = run(found, ARGS, { stdio: ['ignore', 'inherit', 'inherit'] });
if (r.status === null) {
  say('could not run ' + found.file + (r.error ? ': ' + r.error.message : ''));
  process.exit(1);
}
process.exit(r.status);
`;
}

/**
 * A commit guard hook: a POSIX shell preamble that hands the resolver to node. Without node no
 * hitld can run, so the hook warns and lets the commit through, as when no hitld is found.
 * @param {string[]} about the comment lines that say what the hook refuses
 * @param {string} recorded @param {string[]} args
 */
function guardHook(about, recorded, args) {
  const js = resolverScript(recorded, args);
  if (/^HITLD_GUARD$/m.test(js)) throw new Error('the resolver holds its own end marker');
  return [
    '#!/bin/sh',
    `${HOOK_MARK} v2. Written by hitld install, which rewrites it; edit a copy under another name.`,
    ...about,
    '# It finds hitld when it runs: on PATH, then the pinned plugin, then the path recorded at',
    '# install. When none is found it warns and lets the commit through.',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "hitld commit guard: node is not on PATH, so this commit is not checked here (the merge still checks it)" >&2',
    '  exit 0',
    'fi',
    `exec node - "$@" <<'HITLD_GUARD'`,
    js.replace(/\n$/, ''),
    'HITLD_GUARD',
    '',
  ].join('\n');
}

/**
 * The pre-commit hook's text: the classification check over the staged files.
 * @param {string} hitld an absolute path to hitld.mjs, the last place the hook looks
 */
export function hookScript(hitld) {
  return guardHook(
    [
      "# Refuses a commit that adds a file above the repository's classification ceiling (design",
      '# part 10.3). The merge checks the same rule, so skipping this hook does not get a file to main.',
    ],
    hitld,
    ['check', 'classification', '--staged'],
  );
}

/**
 * The commit-msg hook's text: the private term check on the message git hands it.
 * @param {string} hitld an absolute path to hitld.mjs, the last place the hook looks
 */
export function messageHookScript(hitld) {
  return guardHook(
    [
      '# Refuses a commit message that holds a term from the private term list (design part 10.3,',
      "# rule 7). The merge checks each commit's message too, so skipping this hook gains nothing.",
    ],
    hitld,
    ['check', 'commit-message'],
  );
}

/** The hooks install writes: the name, its text, and the line to add to a hook that is not ours. */
const HOOKS = Object.freeze([
  {
    name: /** @type {const} */ ('pre-commit'),
    text: () => hookScript(HITLD),
    line: `node ${shq(HITLD)} check classification --staged`,
  },
  {
    name: /** @type {const} */ ('commit-msg'),
    text: () => messageHookScript(HITLD),
    line: `node ${shq(HITLD)} check commit-message "$1"`,
  },
]);

/**
 * @typedef {{ done: string, warning?: string }} HookDone
 */

/**
 * Install the commit guard's hooks (pre-commit and commit-msg), in the hooks directory every
 * worktree shares. A hook that is not hitld's, or a core.hooksPath the project set, is left alone.
 * @param {string} root
 * @returns {Record<'pre-commit' | 'commit-msg', HookDone>}
 */
function installHooks(root) {
  /** @param {(h: (typeof HOOKS)[number]) => HookDone} f */
  const each = (f) => ({ 'pre-commit': f(HOOKS[0]), 'commit-msg': f(HOOKS[1]) });
  const hooksPath = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (hooksPath.status === 0 && hooksPath.stdout.trim()) {
    return each((h) => ({
      done: 'not installed (core.hooksPath is set)',
      warning: `core.hooksPath is ${hooksPath.stdout.trim()}, so hitld leaves hooks to that setup: have its ${h.name} hook run ${h.line} and stop the commit when it fails`,
    }));
  }
  const common = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (common.status !== 0) {
    return each(() => ({
      done: 'not installed',
      warning: `cannot find the git directory: ${common.stderr.trim()}`,
    }));
  }
  const dir = common.stdout.trim();
  const hooks = join(isAbsolute(dir) ? dir : resolve(root, dir), 'hooks');
  return each((h) => installHook(join(hooks, h.name), h.text(), h.line, h.name));
}

/**
 * Write one hook, unless a hook that is not hitld's is there.
 * @param {string} hook its path @param {string} text @param {string} line @param {string} name
 * @returns {HookDone}
 */
function installHook(hook, text, line, name) {
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
        done: `not installed (a ${name} hook exists)`,
        warning: `${hook} exists and is not hitld's, so it is left as it is: add a line to it that runs ${line} and stops the commit when it fails`,
      };
    }
    if (current === text) return { done: 'unchanged' };
  }
  mkdirSync(dirname(hook), { recursive: true });
  // Trust boundary: the hook's text is fixed here, and the one path in it is this checkout's own
  // hitld.mjs (from import.meta.url), as a JSON string in a quoted here-document; nothing from the
  // repository or input is run (see resolverScript).
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

  // The key is checked before anything is written (HITLD-933): an invalid one would give a
  // policy that check policy refuses and a contract example rendered with the fallback key.
  const policyPath = join(root, POLICY_PATH);
  const given = input.key === undefined ? null : input.key;
  if (given !== null && (typeof given !== 'string' || !new RegExp(KEY_PATTERN).test(given))) {
    return {
      ok: false,
      error: 'usage',
      message: `--key ${typeof given === 'string' ? given : '(no value)'} is not a tracker ID key: it must match ${KEY_PATTERN} (capital letters and digits, starting with a letter, at most 10; SIG, P, C and D are reserved); nothing was written`,
    };
  }
  if (given !== null && existsSync(policyPath)) {
    // Read as written, not through loadPolicy: a policy whose key fails the schema still has one.
    /** @type {unknown} */
    let existing;
    try {
      existing = readJson(policyPath).project?.key;
    } catch {
      existing = undefined;
    }
    if (existing !== given) {
      return {
        ok: false,
        error: 'usage',
        message: `--key ${given} differs from the key in ${POLICY_PATH} (${typeof existing === 'string' ? existing : 'none'}); install does not change an existing policy's key: drop --key, or change project.key in ${POLICY_PATH} yourself; nothing was written`,
      };
    }
  }

  // policy.json
  if (existsSync(policyPath)) {
    done.policy = 'kept';
  } else {
    const key = typeof given === 'string' ? given : null;
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
    // Every repository declares at least one release package (HITLD-783): the first owns every
    // path and is named after the project, with the default tag template {name}@{version}.
    const name =
      id
        .replace(/[^a-z0-9]+$/, '')
        .slice(0, 64)
        .replace(/[^a-z0-9]+$/, '') || 'main';
    policy.release = {
      packages: [
        {
          name,
          paths: ['**'],
          ...(existsSync(join(root, 'package.json')) ? { version_source: 'package.json' } : {}),
        },
      ],
    };
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
  // autoUpdate false: the plugin moves only when the pin does, by a commit the owner merges
  // (design part 16.5, Upgrades). It is also Claude Code's default for a marketplace of this kind.
  settings.extraKnownMarketplaces = {
    ...(settings.extraKnownMarketplaces ?? {}),
    [MARKETPLACE]: { source, autoUpdate: false },
  };
  settings.enabledPlugins = {
    ...(settings.enabledPlugins ?? {}),
    [`${PLUGIN}@${MARKETPLACE}`]: true,
  };
  writeJson(settingsPath, settings);
  done.settings = '.claude/settings.json';
  done.store_sync_hooks =
    'the plugin carries them: SessionStart pulls the private store, SessionEnd pushes it; both do nothing until a store address is set (HITLD_STORE_REMOTE, or hitld store remote set)';

  // The usage capture is opt-in (--statusline). The default quota is the subscription's weekly
  // window, read only from the status line, and a quota with no reading stops dispatch.
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

  // The commit guard: the pre-commit hook over the files, the commit-msg hook over the message.
  const hooks = installHooks(root);
  done.commit_guard = hooks['pre-commit'].done;
  done.message_guard = hooks['commit-msg'].done;
  for (const h of Object.values(hooks)) if (h.warning) warnings.push(h.warning);

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
