// `hitld work ref` (HITLD-807): how a session names an item to the owner, as "ID: title (link)",
// read from the tracker and git, so no title or link is written from memory. The link is the
// item's file on the forge: on the main branch once the file is there, else on the branch that
// holds it (a pull request's branch, a branch this checkout published, or the session's own).
// Read-only: nothing is fetched, so a ref the checkout has not fetched is not seen.

import { git } from './tree.mjs';
import { PUBLISHED_REFS, forgeRepo } from './publish.mjs';

/**
 * @typedef {{ id: string, title: string, path: string, branch: string | null, on_main: boolean,
 *   pushed: boolean, link: string | null, line: string }} ItemRef
 */

/** A branch name or path as URL path segments, "/" kept. @param {string} s */
const segments = (s) => s.split('/').map(encodeURIComponent).join('/');

/**
 * Refs of one kind, newest commit first, as [ref, branch name] pairs.
 * @param {string} root @param {string} pattern @param {string} prefix stripped to give the branch
 */
function refsUnder(root, pattern, prefix) {
  return git(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)', pattern], {
    allowFail: true,
  })
    .split('\n')
    .filter(Boolean)
    .map((ref) => /** @type {[string, string]} */ ([ref, ref.slice(prefix.length)]));
}

/**
 * The places an item's file may be, in the order a link prefers them: the main branch (the
 * remote's copy, then the local one), the branches this checkout published, the remote's other
 * branches, then the checkout's own branch, which may not be pushed.
 * @param {string} root @param {string} mainBranch @param {string} remote
 * @returns {{ ref: string, branch: string, main: boolean, pushed: boolean }[]}
 */
function placesOf(root, mainBranch, remote) {
  const tracking = `refs/remotes/${remote}/`;
  /** @type {{ ref: string, branch: string, main: boolean, pushed: boolean }[]} */
  const out = [
    { ref: `${tracking}${mainBranch}`, branch: mainBranch, main: true, pushed: true },
    { ref: `refs/heads/${mainBranch}`, branch: mainBranch, main: true, pushed: true },
  ];
  for (const [ref, branch] of refsUnder(root, PUBLISHED_REFS, `${PUBLISHED_REFS}/`)) {
    out.push({ ref, branch, main: false, pushed: true });
  }
  for (const [ref, branch] of refsUnder(root, `${tracking}`, tracking)) {
    if (branch === 'HEAD' || branch === mainBranch) continue;
    out.push({ ref, branch, main: false, pushed: true });
  }
  const current = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    allowFail: true,
  }).trim();
  if (current && current !== mainBranch) {
    out.push({ ref: `refs/heads/${current}`, branch: current, main: false, pushed: false });
  }
  return out;
}

/**
 * The reference line for each entity: "ID: title (link)".
 * @param {{ root: string, mainBranch: string, remote: string,
 *   entities: { id: string, title: string, path: string }[] }} o
 * @returns {{ repo: string | null, refs: ItemRef[] }}
 */
export function itemRefs({ root, mainBranch, remote, entities }) {
  const repo = forgeRepo(root, remote);
  const places = placesOf(root, mainBranch, remote);
  // One git call answers, for every item and place, whether the place holds the item's file.
  const asks = entities.flatMap((e) => places.map((p) => `${p.ref}:${e.path}`));
  const answers = asks.length
    ? git(root, ['cat-file', '--batch-check=%(objecttype)'], {
        input: `${asks.join('\n')}\n`,
        allowFail: true,
      }).split('\n')
    : [];
  const refs = entities.map((e, i) => {
    const found = places.find((_, j) => answers[i * places.length + j] === 'blob') ?? null;
    const link =
      repo && found && found.pushed
        ? `https://github.com/${repo}/blob/${segments(found.branch)}/${segments(e.path)}`
        : null;
    const where = link
      ? link
      : !repo
        ? `${e.path}; the remote ${remote} is not on github.com`
        : found
          ? `${e.path} on ${found.branch}, not pushed`
          : `${e.path}, on no branch yet`;
    return {
      id: e.id,
      title: e.title,
      path: e.path,
      branch: found?.branch ?? null,
      on_main: Boolean(found?.main),
      pushed: Boolean(found?.pushed),
      link,
      line: `${e.id}: ${e.title} (${where})`,
    };
  });
  return { repo, refs };
}
