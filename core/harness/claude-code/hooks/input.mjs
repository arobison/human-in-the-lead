// Shared by the plugin's hook scripts: read the hook input, and tell an executor from anyone else.
// Plugin agent definitions cannot carry hooks of their own (design part 15.4), so the hooks are
// plugin-wide and act only on executors: a subagent of the plugin's executor types, a headless
// tier-3 run, whose environment carries HITLD_DISPATCH, or any session whose checkout holds an
// executor's claim (HITLD-781). The last is how a session started without the variable, such as
// one started in the cloud, is known: its branch starts with the claim commit.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DISPATCH_ID } from '../../../lib/ledger/ids.mjs';

/** @returns {Record<string, any>} */
export function readHookInput() {
  try {
    const data = JSON.parse(readFileSync(0, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, any>} input @param {NodeJS.ProcessEnv} env */
export function isExecutor(input, env) {
  if (typeof input.agent_type === 'string') {
    if (/^human-in-the-lead:executor(-tier\d)?$/.test(input.agent_type)) return true;
    // Another kind of subagent is an executor's only when it works in an executor's checkout,
    // so an executor cannot hand a refused command to a subagent of its own.
  } else if (typeof env.HITLD_DISPATCH === 'string' && DISPATCH_ID.test(env.HITLD_DISPATCH)) {
    // Either form of dispatch ID: numbered before HITLD-74, or unique by construction.
    return true;
  }
  // The session's project and the directory it is in now are both read, so changing directory
  // out of the checkout does not shed the guard.
  const dirs = new Set(
    [env.CLAUDE_PROJECT_DIR, input.cwd].filter((d) => typeof d === 'string' && d !== ''),
  );
  if (!dirs.size) dirs.add(process.cwd());
  return [...dirs].some(holdsExecutorClaim);
}

/**
 * Whether the checkout at `dir` is an executor's: HEAD holds a claim commit (message `claim: <ID>`
 * with a `Dispatch:` trailer naming a dispatch, the form `hitld work claim` writes, see
 * core/lib/tracker/files/claims.mjs) that no main branch holds yet. The branch's name is not read,
 * so renaming the branch or detaching HEAD keeps the claim in view. The main branches are `main`
 * locally and on every remote, and the branch origin's HEAD names, read from refs rather than the
 * policy file, which the executor's own branch can change. A directory outside any repository
 * holds no claim. Anything else that stops git from answering (it cannot start, it fails, it
 * times out, or no main branch exists while HEAD holds a dispatch's claim) counts as an
 * executor's: the guard fails closed.
 * @param {string} dir
 */
function holdsExecutorClaim(dir) {
  return claimIn(dir).state !== 'none';
}

/**
 * The branch an executor's checkout at `dir` is on, when it is its own claim branch: HEAD is on a
 * branch (not detached), git answers, HEAD holds an executor's claim commit no main branch holds,
 * and the branch is not a main branch. Else null. Unlike `holdsExecutorClaim`, which fails closed
 * to guard, this fails closed to refuse: anything git does not answer gives null.
 * @param {string} dir @returns {string | null}
 */
export function ownClaimBranch(dir) {
  const c = claimIn(dir);
  if (c.state !== 'claim' || !c.branch) return null;
  const ref = `refs/heads/${c.branch}`;
  if (
    c.branch === 'main' ||
    c.bases.has(ref) ||
    [...c.bases].some((b) => b.replace(/^refs\/remotes\/[^/]+\//, '') === c.branch)
  ) {
    return null;
  }
  return c.branch;
}

/**
 * What the checkout at `dir` holds: `claim` (an executor's claim commit), `none` (no claim, or
 * not a repository), or `unknown` (git did not answer). With the branch HEAD is on and the main
 * branches read.
 * @param {string} dir
 * @returns {{ state: 'claim' | 'none' | 'unknown', branch: string | null, bases: Set<string> }}
 */
function claimIn(dir) {
  /** @type {Set<string>} */
  const bases = new Set();
  /** @param {'claim' | 'none' | 'unknown'} state @param {string | null} [branch] */
  const out = (state, branch = null) => ({ state, branch, bases });
  /** @param {string[]} args */
  const run = (args) =>
    spawnSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      // Untranslated, so "not a git repository" reads the same in every locale.
      env: { ...process.env, LC_ALL: 'C' },
    });
  const refs = run([
    'for-each-ref',
    '--format=%(refname)%09%(symref)',
    'refs/heads/main',
    'refs/remotes/*/main',
    'refs/remotes/origin/HEAD',
  ]);
  if (refs.error) return out('unknown');
  if (refs.status !== 0) {
    return out(/not a git repository/i.test(refs.stderr ?? '') ? 'none' : 'unknown');
  }
  for (const line of refs.stdout.split('\n')) {
    const [name, target] = line.split('\t');
    if (name === 'refs/remotes/origin/HEAD') {
      if (target) bases.add(target);
    } else if (name) bases.add(name);
  }
  const log = run([
    'log',
    '--ignore-missing',
    'HEAD',
    ...(bases.size ? ['--not', ...bases] : []),
    '-E',
    '--grep=^claim: ',
    '--format=%B%x1e',
  ]);
  if (log.error || log.status !== 0) return out('unknown');
  const claimed = log.stdout.split('\x1e').some((message) => {
    const lines = message.trim().split('\n');
    return (
      /^claim: \S+$/.test(lines[0] ?? '') &&
      lines.some((l) => {
        const m = /^Dispatch: (\S+)\s*$/.exec(l);
        return m !== null && DISPATCH_ID.test(m[1]);
      })
    );
  });
  if (!claimed) return out('none');
  const head = run(['symbolic-ref', '--short', '-q', 'HEAD']);
  const branch = !head.error && head.status === 0 ? head.stdout.trim() || null : null;
  return out('claim', branch);
}
