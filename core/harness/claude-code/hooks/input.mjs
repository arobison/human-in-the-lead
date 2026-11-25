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
  const d = claimedDispatches(dir);
  return d === null || d.length > 0;
}

/**
 * The dispatches the claim commits on HEAD (and on no main branch) name, newest first; null when
 * git cannot answer. For the budget hook (budget.mjs), which needs the dispatch of a session started
 * without HITLD_DISPATCH.
 * @param {string} dir @returns {string[] | null}
 */
export function claimedDispatches(dir) {
  const claims = readClaims(dir).claims;
  return claims && claims.map((c) => c.dispatch);
}

/**
 * @typedef {{ dispatch: string, cap: number | null, since: string }} Claim a claim commit's
 *   dispatch; the token cap its `Budget-Tokens` trailer carries (HITLD-841), or null; and when its
 *   usage starts: the claim's author time, or the newest close of the same item after it, where a
 *   follow-up dispatch in the same session starts
 */

/**
 * The claims on HEAD (and on no main branch), newest first; null when git cannot answer. For the
 * budget hook in a session whose private store does not hold the dispatch (a cloud executor).
 * @param {string} dir @returns {Claim[] | null}
 */
export function claimedBudgets(dir) {
  return readClaims(dir).claims;
}

/**
 * The branch an executor's checkout at `dir` is on, when it is its own claim branch: HEAD is on a
 * branch (not detached), git answers, HEAD holds an executor's claim commit no main branch holds,
 * and the branch is not a main branch. Else null. Unlike `holdsExecutorClaim`, which fails closed
 * to guard, this fails closed to refuse: anything git does not answer gives null (HITLD-746).
 * @param {string} dir @returns {string | null}
 */
export function ownClaimBranch(dir) {
  const c = readClaims(dir);
  if (!c.claims?.length) return null;
  const head = c.run(['symbolic-ref', '--short', '-q', 'HEAD']);
  const branch = !head.error && head.status === 0 ? head.stdout.trim() || null : null;
  if (
    !branch ||
    branch === 'main' ||
    c.bases.has(`refs/heads/${branch}`) ||
    [...c.bases].some((b) => b.replace(/^refs\/remotes\/[^/]+\//, '') === branch)
  ) {
    return null;
  }
  return branch;
}

/**
 * Why a `git push origin <branch>` from `dir` might not go only to the project's remote, or might
 * carry more than the branch named (HITLD-793); null when it goes as written. The project's
 * remote is `origin` with the one URL it is configured with: a push URL of its own, an insteadOf
 * or pushInsteadOf rewrite, or a second URL sends the push elsewhere. Configuration can also
 * change what an explicit refspec pushes: `remote.origin.push` maps it to another ref (main, say),
 * `remote.origin.mirror` and `push.followTags` push more refs, and submodule recursion pushes
 * other repositories. Anything git does not answer is a reason too: the guard fails closed.
 * @param {string} dir @returns {string | null}
 */
export function originPushProblem(dir) {
  /** @param {string[]} args */
  const run = (args) =>
    spawnSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env: { ...process.env, LC_ALL: 'C' },
    });
  /** @param {ReturnType<typeof run>} r */
  const lines = (r) => r.stdout.split('\n').filter((l) => l !== '');
  const configured = run(['config', '--get-all', 'remote.origin.url']);
  const pushTo = run(['remote', 'get-url', '--push', '--all', 'origin']);
  if (configured.error || pushTo.error || configured.status !== 0 || pushTo.status !== 0) {
    return 'git cannot tell where origin is';
  }
  const urls = lines(configured);
  if (urls.length !== 1 || lines(pushTo).join('\n') !== urls[0]) {
    return 'origin pushes somewhere other than its one configured URL (a push URL, a URL rewrite or a second URL)';
  }
  const set = run([
    'config',
    '--name-only',
    '--get-regexp',
    '^(remote\\.origin\\.(push|pushurl|mirror)|push\\.(followtags|recursesubmodules)|submodule\\.recurse)$',
  ]);
  // Status 1 is git's "no such key"; anything else but 0 is git not answering.
  if (set.error || (set.status !== 0 && set.status !== 1)) {
    return 'git cannot tell how a push is configured';
  }
  const keys = lines(set);
  return keys.length ? `git configuration changes what the push sends: ${keys.join(', ')}` : null;
}

/**
 * What the checkout at `dir` holds: the dispatches its claim commits name, each with the cap its
 * `Budget-Tokens` trailer carries (null when git cannot answer, empty outside a repository or with
 * no claim), the main branches read, and the way git was run there.
 * @param {string} dir
 */
function readClaims(dir) {
  /** @type {Set<string>} */
  const bases = new Set();
  /** @param {string[]} args */
  const run = (args) =>
    spawnSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      // Untranslated, so "not a git repository" reads the same in every locale.
      env: { ...process.env, LC_ALL: 'C' },
    });
  /** @param {Claim[] | null} claims */
  const out = (claims) => ({ claims, bases, run });
  const refs = run([
    'for-each-ref',
    '--format=%(refname)%09%(symref)',
    'refs/heads/main',
    'refs/remotes/*/main',
    'refs/remotes/origin/HEAD',
  ]);
  if (refs.error) return out(null);
  if (refs.status !== 0) return out(/not a git repository/i.test(refs.stderr ?? '') ? [] : null);
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
    '--grep=^(claim|close): ',
    '--format=%aI%x1f%B%x1e',
  ]);
  if (log.error || log.status !== 0) return out(null);
  /** @type {{ dispatch: string, cap: number | null, item: string, at: string }[]} */
  const claims = [];
  /** @type {{ item: string, at: string }[]} */
  const closes = [];
  for (const record of log.stdout.split('\x1e')) {
    const [at = '', message = ''] = record.replace(/^\n+/, '').split('\x1f');
    const lines = message.trim().split('\n');
    const head = /^(claim|close): (\S+)$/.exec(lines[0] ?? '');
    if (!head) continue;
    if (head[1] === 'close') {
      closes.push({ item: head[2], at });
      continue;
    }
    const budget = lines.map((l) => /^Budget-Tokens: ([1-9]\d{0,11})\s*$/.exec(l)).find(Boolean);
    const cap = budget ? Number(budget[1]) : null;
    for (const l of lines) {
      const m = /^Dispatch: (\S+)\s*$/.exec(l);
      if (m !== null && DISPATCH_ID.test(m[1]))
        claims.push({ dispatch: m[1], cap, item: head[2], at });
    }
  }
  return out(
    claims.map((c) => {
      // A follow-up continues the item after its last close: its usage counts from there.
      const after = closes
        .filter((x) => x.item === c.item && Date.parse(x.at) > Date.parse(c.at))
        .map((x) => x.at)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
      return { dispatch: c.dispatch, cap: c.cap, since: after ?? c.at };
    }),
  );
}
