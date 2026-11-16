// The GitHub API, as the pull-request merge path uses it (design part 14.2, merge.via
// pull-request). Two clients share one interface: the real one shells out to the GitHub command
// line, `gh api`, with an argument list (never a shell string) and the request body on standard
// input; the fake keeps pull requests in memory and merges into a git repository standing in for
// GitHub, so the tests and evals run the whole flow offline.
//
// HITLd stores no token: gh brings the session's own sign-in, as the feedback filer does.

import { execFileSync, spawnSync } from 'node:child_process';

/**
 * @typedef {{ number: number, url: string, head: string, state: 'open' | 'closed', merged?: boolean }} PullRequest
 * @typedef {{ name: string, state: 'success' | 'failure' | 'pending', url?: string }} Check
 *   one check on a commit: a check run or a commit status, by its name or context
 * @typedef {{ merged: true, sha: string } | { merged: false, message: string }} MergeResult
 *
 * @typedef {object} GitHub
 * @property {string} name 'gh' or 'fake'
 * @property {string} repo owner/name
 * @property {(branch: string, base: string) => PullRequest | null} findPull the open pull request from this branch
 * @property {(p: { head: string, base: string, title: string, body: string }) => PullRequest} createPull
 * @property {(number: number, p: { title: string, body: string }) => PullRequest} updatePull
 * @property {(sha: string) => Check[]} checks the checks reported on a commit
 * @property {(number: number, p: { sha: string, title: string, message: string }) => MergeResult} mergePull
 *   a squash merge, only while the pull request's head is still `sha`
 */

/**
 * The owner/name of a GitHub repository from a remote URL: https, ssh, or a proxy that keeps the
 * owner and name as the last two path segments. Null when it has no such segments. A local path
 * counts the same way on Windows as elsewhere: "\" separates segments there too.
 * @param {string} url @returns {string | null}
 */
export function repoFromRemote(url) {
  const m = /[/:\\]([A-Za-z0-9_.-]+)[/\\]([A-Za-z0-9_.-]+?)(?:\.git)?[/\\]?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** @param {string} s */
const checkState = (s) => {
  if (['success', 'neutral', 'skipped'].includes(s)) return 'success';
  // GitHub's own conclusion values, spelled as the API sends them. spelling-ok
  const failed = ['failure', 'error', 'cancelled', 'timed_out', 'action_required', 'stale']; // spelling-ok
  if (failed.includes(s)) {
    return 'failure';
  }
  return 'pending';
};

/**
 * The real client: `gh api`. It runs with the caller's environment, so gh uses the session's own
 * sign-in, and fails without one.
 * @param {{ repo: string, env: NodeJS.ProcessEnv }} o @returns {GitHub}
 */
export function ghGitHub({ repo, env }) {
  const owner = repo.split('/')[0];
  /**
   * @param {string} method @param {string} path @param {unknown} [body]
   * @returns {{ ok: boolean, json: any, message: string }}
   */
  const api = (method, path, body) => {
    const args = ['api', '-X', method, '-H', 'Accept: application/vnd.github+json', path];
    if (body !== undefined) args.push('--input', '-');
    // Trust boundary: GitHub, through the session's own sign-in. An argument list, so no shell
    // reads a branch name or a title.
    const r = spawnSync('gh', args, {
      input: body === undefined ? undefined : JSON.stringify(body),
      encoding: 'utf8',
      env,
      timeout: 60_000,
    });
    if (r.error && /** @type {{ code?: string }} */ (r.error).code === 'ENOENT') {
      throw new Error(
        'the GitHub command line (gh) is not installed; merge.via pull-request needs it',
      );
    }
    /** @type {any} */
    let json = null;
    try {
      json = JSON.parse(r.stdout || 'null');
    } catch {
      json = null;
    }
    const message = String(json?.message ?? r.stderr ?? '').trim() || `gh api ${path} failed`;
    return { ok: r.status === 0, json, message };
  };
  /** @param {any} p @returns {PullRequest} */
  const pull = (p) => ({
    number: p.number,
    url: p.html_url,
    head: p.head?.sha,
    state: p.state === 'open' ? 'open' : 'closed',
    merged: Boolean(p.merged || p.merged_at),
  });
  /** @param {{ ok: boolean, json: any, message: string }} r @param {string} what */
  const must = (r, what) => {
    if (!r.ok) throw new Error(`${what}: ${r.message}`);
    return r.json;
  };
  return {
    name: 'gh',
    repo,
    findPull(branch, base) {
      const q = `head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(base)}&state=open`;
      const list = must(api('GET', `repos/${repo}/pulls?${q}`), 'listing pull requests');
      return Array.isArray(list) && list.length ? pull(list[0]) : null;
    },
    createPull(p) {
      return pull(
        must(api('POST', `repos/${repo}/pulls`, p), `opening a pull request from ${p.head}`),
      );
    },
    updatePull(number, p) {
      return pull(must(api('PATCH', `repos/${repo}/pulls/${number}`, p), `updating #${number}`));
    },
    checks(sha) {
      const runs = must(
        api('GET', `repos/${repo}/commits/${sha}/check-runs?per_page=100`),
        `reading the checks on ${sha.slice(0, 12)}`,
      );
      const statuses = must(
        api('GET', `repos/${repo}/commits/${sha}/status`),
        `reading the statuses on ${sha.slice(0, 12)}`,
      );
      /** @type {Check[]} */
      const out = [];
      for (const c of runs?.check_runs ?? []) {
        out.push({
          name: c.name,
          state: c.status === 'completed' ? checkState(c.conclusion) : 'pending',
          ...(c.html_url ? { url: c.html_url } : {}),
        });
      }
      for (const s of statuses?.statuses ?? []) {
        out.push({
          name: s.context,
          state: checkState(s.state),
          ...(s.target_url ? { url: s.target_url } : {}),
        });
      }
      return out;
    },
    mergePull(number, p) {
      const r = api('PUT', `repos/${repo}/pulls/${number}/merge`, {
        merge_method: 'squash',
        sha: p.sha,
        commit_title: p.title,
        commit_message: p.message,
      });
      return r.ok && r.json?.merged
        ? { merged: true, sha: r.json.sha }
        : { merged: false, message: r.message };
    },
  };
}

/**
 * A fake GitHub for tests and evals: pull requests in memory, branches and main in `remote` (a
 * bare repository the queue pushes to and fetches from, as it would GitHub). Its checks come from
 * `checks`, which sees the branch and the commit; a squash merge writes one commit on main with the
 * message given, only while the head is the commit named and the branch merges cleanly.
 * @param {{ remote: string, repo?: string, mainBranch?: string,
 *   checks?: (p: { branch: string, sha: string }) => Check[] }} o
 * @returns {GitHub & { pulls: (PullRequest & { branch: string, base: string, title: string, body: string })[],
 *   merges: { number: number, sha: string, title: string, message: string }[] }}
 */
export function fakeGitHub(o) {
  const repo = o.repo ?? 'example/project';
  const main = o.mainBranch ?? 'main';
  /** @param {string[]} args */
  const git = (args) => {
    const r = spawnSync('git', args, {
      cwd: o.remote,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fake GitHub',
        GIT_AUTHOR_EMAIL: 'noreply@example.com',
        GIT_COMMITTER_NAME: 'Fake GitHub',
        GIT_COMMITTER_EMAIL: 'noreply@example.com',
      },
    });
    return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
  };
  /** @param {string} ref */
  const tip = (ref) => {
    const r = git(['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`]);
    return r.ok ? r.out : '';
  };
  /** @type {(PullRequest & { branch: string, base: string, title: string, body: string })[]} */
  const pulls = [];
  /** @type {{ number: number, sha: string, title: string, message: string }[]} */
  const merges = [];
  /** @param {PullRequest & { branch: string }} p */
  const fresh = (p) => {
    if (p.state === 'open') p.head = tip(p.branch);
    return { number: p.number, url: p.url, head: p.head, state: p.state, merged: p.merged };
  };
  return {
    name: 'fake',
    repo,
    pulls,
    merges,
    findPull(branch, base) {
      const p = pulls.find((x) => x.branch === branch && x.base === base && x.state === 'open');
      return p ? fresh(p) : null;
    },
    createPull(p) {
      if (!tip(p.head)) throw new Error(`opening a pull request from ${p.head}: no such branch`);
      const n = pulls.length + 1;
      const made = {
        number: n,
        url: `https://github.com/${repo}/pull/${n}`,
        head: tip(p.head),
        state: /** @type {'open'} */ ('open'),
        merged: false,
        branch: p.head,
        base: p.base,
        title: p.title,
        body: p.body,
      };
      pulls.push(made);
      return fresh(made);
    },
    updatePull(number, p) {
      const found = pulls.find((x) => x.number === number);
      if (!found) throw new Error(`updating #${number}: no such pull request`);
      found.title = p.title;
      found.body = p.body;
      return fresh(found);
    },
    checks(sha) {
      const p = pulls.find((x) => x.state === 'open' && tip(x.branch) === sha);
      return o.checks?.({ branch: p?.branch ?? '', sha }) ?? [];
    },
    mergePull(number, p) {
      const found = pulls.find((x) => x.number === number);
      if (!found || found.state !== 'open')
        return { merged: false, message: 'Pull Request is not open' };
      const head = tip(found.branch);
      if (head !== p.sha) return { merged: false, message: 'Head branch was modified' };
      const base = tip(main);
      const tree = git(['merge-tree', '--write-tree', base, head]);
      if (!tree.ok) return { merged: false, message: 'Pull Request is not mergeable' };
      const made = git([
        'commit-tree',
        tree.out.split('\n')[0],
        '-p',
        base,
        '-m',
        `${p.title}\n\n${p.message}`,
      ]);
      if (!made.ok || !git(['update-ref', `refs/heads/${main}`, made.out, base]).ok) {
        return { merged: false, message: 'Base branch was modified' };
      }
      found.state = 'closed';
      found.merged = true;
      merges.push({ number, sha: made.out, title: p.title, message: p.message });
      return { merged: true, sha: made.out };
    },
  };
}

/** The remote's URL, or null. @param {string} repoRoot @param {string} remote */
export function remoteUrl(repoRoot, remote) {
  try {
    return execFileSync('git', ['remote', 'get-url', remote], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
