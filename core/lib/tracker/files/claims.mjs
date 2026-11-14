// Claims, closing and releasing (design part 3.4, "Claims and closing").
//
// - A claim is the first commit of the executor's branch: it changes only the item file, to
//   `status: In progress` and `claimed: <dispatch ID>`, with the message `claim: <ID>`.
// - The branch is where the claim lives. The main branch never shows a work item In progress, so
//   which items are claimed is read from branches: local ones, remote-tracking ones and the ref
//   prefixes where a second machine's bundles are fetched.
// - Closing rides with the work: a commit on the same branch sets `status: Done`. Merging the
//   branch closes the item.
// - An abandoned claim is released by the orchestrator with a commit on the main branch that
//   names the branch and the claim commit and records why. The commit may be empty: main already
//   shows the item Planned. A claim whose commit a release names stops counting.
//
// Claim and close commits carry `Work-Item:` and `Dispatch:`; the executor's own commits add the
// `Agent-*` trailers (the owner's answer to Q5, 2026-11-14)
// (design part 22). Nothing here pushes.

import { applyPatch } from './format.mjs';
import { findEntry, writeStored } from './edit.mjs';
import { git, idNumber, loadPlaces, refPlaces } from './tree.mjs';

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry} Entry
 *
 * @typedef {object} Claim
 * @property {string} claimant the `claimed` value: a dispatch ID, a session or a person's handle
 * @property {string} branch the ref's short name, such as `exec/app-5` or `origin/exec/app-5`
 * @property {string} ref the full ref
 * @property {string | null} commit the claim commit, when it can be found
 * @property {string | null} at when that commit was made (ISO 8601)
 * @property {'local' | 'remote' | 'bundle'} source
 *
 * @typedef {object} ClaimedItem
 * @property {string} id
 * @property {string} title
 * @property {Claim[]} claims
 * @property {boolean} double more than one claimant, or the same claimant on more than one branch
 */

/** @param {Layout} layout @param {string} ref @returns {Claim['source']} */
function sourceOf(layout, ref) {
  if (layout.bundleRefs.some((p) => ref.startsWith(p))) return 'bundle';
  return ref.startsWith('refs/remotes/') ? 'remote' : 'local';
}

/** The main branch's ref, or null when it does not exist yet. @param {string} root @param {Layout} layout */
function mainRef(root, layout) {
  const ref = `refs/heads/${layout.mainBranch}`;
  return git(root, ['rev-parse', '--verify', '-q', ref], { allowFail: true }).trim() ? ref : null;
}

/**
 * Claim commits that a release on the main branch has retired, by their hashes.
 * @param {string} root @param {Layout} layout
 * @returns {Set<string>}
 */
export function releasedClaims(root, layout) {
  const main = mainRef(root, layout);
  if (!main) return new Set();
  const log = git(root, ['log', main, '-E', '--grep=^release: ', '--format=%B%x1e'], {
    allowFail: true,
  });
  return new Set([...log.matchAll(/^Claim-Commit: ([0-9a-f]{7,64})\s*$/gm)].map((m) => m[1]));
}

/**
 * The claim commit on a ref for an item: the first commit since the main branch that sets the
 * item In progress (message `claim: <ID>`), or failing that the oldest commit touching its file.
 * @param {string} root @param {Layout} layout @param {string} ref @param {string} id @param {string} path
 * @returns {{ commit: string, at: string } | null}
 */
function claimCommit(root, layout, ref, id, path) {
  const main = mainRef(root, layout);
  const range = main ? [`${main}..${ref}`] : [ref];
  /** @param {string[]} extra */
  const first = (extra) => {
    const out = git(root, ['log', ...range, '--reverse', '--format=%H %cI', ...extra, '--', path], {
      allowFail: true,
    })
      .split('\n')
      .find(Boolean);
    if (!out) return null;
    const [commit, at] = out.split(' ');
    return { commit, at };
  };
  return first(['-E', `--grep=^claim: ${id}$`]) ?? first([]);
}

/**
 * Claims read from branches: every item that is In progress on a ref other than the main branch
 * where the main branch's copy differs (it shows it Planned). Claims a release has retired do not
 * count.
 * @param {string} root @param {Layout} layout
 * @returns {ClaimedItem[]}
 */
export function findClaims(root, layout) {
  const main = mainRef(root, layout);
  const refs = refPlaces(root, layout).filter(
    (p) => p.ref !== main && !(p.ref ?? '').endsWith(`/${layout.mainBranch}`),
  );
  const mainItems = main
    ? new Map(
        (loadPlaces(root, layout, [{ where: layout.mainBranch, ref: main }])[0]?.items ?? []).map(
          (e) => [String(e.data?.id), e.data],
        ),
      )
    : new Map();
  const released = releasedClaims(root, layout);
  /** @type {Map<string, ClaimedItem>} */
  const claimed = new Map();
  for (const { ref, items } of loadPlaces(root, layout, refs)) {
    for (const it of items) {
      const d = it.data;
      if (!d?.id || d.status !== 'In progress' || d.kind === 'project' || d.kind === 'initiative') {
        continue;
      }
      const here = mainItems.get(String(d.id));
      if (here && here.status === d.status && here.claimed === d.claimed) continue; // not news
      const id = String(d.id);
      const found = claimCommit(root, layout, String(ref), id, it.path);
      if (
        found &&
        [...released].some((r) => found.commit.startsWith(r) || r.startsWith(found.commit))
      ) {
        continue;
      }
      if (!claimed.has(id)) {
        claimed.set(id, { id, title: String(d.title), claims: [], double: false });
      }
      /** @type {ClaimedItem} */ (claimed.get(id)).claims.push({
        claimant: String(d.claimed ?? '?'),
        branch: String(ref).replace(/^refs\/(heads|remotes)\//, ''),
        ref: String(ref),
        commit: found?.commit ?? null,
        at: found?.at ?? null,
        source: sourceOf(layout, String(ref)),
      });
    }
  }
  const rank = { local: 0, remote: 1, bundle: 2 };
  for (const c of claimed.values()) {
    c.claims.sort((a, b) => rank[a.source] - rank[b.source] || a.branch.localeCompare(b.branch));
  }
  const out = [...claimed.values()].sort((a, b) => idNumber(a.id) - idNumber(b.id));
  for (const c of out) c.double = c.claims.length > 1;
  return out;
}

/**
 * Claims that do not match the ledger's in-flight dispatches, both ways (design part 3.2): a
 * claim branch whose dispatch has no open dispatch, and an open dispatch with no claim branch.
 * Only claimants that are dispatch IDs (`D-<n>`) are matched; a person's handle is not a dispatch.
 * @param {ClaimedItem[]} claims @param {string[]} inflight dispatch IDs without a terminal event
 * @returns {string[]} problems
 */
export function findOrphans(claims, inflight) {
  /** @type {string[]} */
  const problems = [];
  const open = new Set(inflight);
  const claimants = new Set();
  for (const c of claims) {
    for (const cl of c.claims) {
      claimants.add(cl.claimant);
      if (/^D-[1-9]\d*$/.test(cl.claimant) && !open.has(cl.claimant)) {
        problems.push(
          `${c.id} is claimed by ${cl.claimant} on ${cl.branch}, but that dispatch is not in flight (an abandoned branch?)`,
        );
      }
    }
  }
  for (const d of open) {
    if (!claimants.has(d)) problems.push(`${d} is in flight but has no claim branch`);
  }
  return problems;
}

/** The branch HEAD is on, or null when detached. @param {string} root */
export function currentBranch(root) {
  return git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true }).trim() || null;
}

/** @param {string} root @param {string[]} files @param {{ subject: string, body: string }} message */
function commitOnly(root, files, message) {
  git(root, [
    'commit',
    '--only',
    '--no-verify',
    '-m',
    message.subject,
    '-m',
    message.body,
    '--',
    ...files,
  ]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

/** @param {string} id @param {string} claimant */
const trailers = (id, claimant) =>
  [`Work-Item: ${id}`, ...(/^D-[1-9]\d*$/.test(claimant) ? [`Dispatch: ${claimant}`] : [])].join(
    '\n',
  );

/**
 * Write the claim commit for an item on the current (executor) branch.
 * @param {string} root @param {Layout} layout @param {string} id @param {string} claimant
 * @param {{ branch?: string }} [options] branch: refuse unless HEAD is on it
 * @returns {{ commit: string, branch: string }}
 */
export function claimItem(root, layout, id, claimant, { branch } = {}) {
  const here = currentBranch(root);
  if (!here) throw new Error('claim from a branch, not a detached HEAD');
  if (here === layout.mainBranch) {
    throw new Error(`claim on the executor's branch, never on ${layout.mainBranch}`);
  }
  if (branch && branch !== here) throw new Error(`this working tree is on ${here}, not ${branch}`);
  if (!claimant.trim()) throw new Error('a claim needs a claimant (a dispatch ID)');
  const entry = findEntry(root, layout, id);
  if (!entry?.data) throw new Error(`${id} is not in this working tree`);
  const d = entry.data;
  if (d.kind === 'project' || d.kind === 'initiative')
    throw new Error(`${id} is a ${d.kind}; claim items`);
  if (d.status !== 'Planned') {
    throw new Error(`${id} is ${d.status}; only a Planned item can be claimed`);
  }
  for (const c of findClaims(root, layout)) {
    if (c.id === id) {
      const by = c.claims.map((x) => `${x.claimant} on ${x.branch}`).join('; ');
      throw new Error(`${id} is already claimed by ${by}`);
    }
  }
  const stored = applyPatch(entry.data, { status: 'In progress', claimed: claimant }, layout);
  writeStored(root, layout, entry.path, stored, entry.body);
  const commit = commitOnly(root, [entry.path], {
    subject: `claim: ${id}`,
    body: trailers(id, claimant),
  });
  return { commit, branch: here };
}

/**
 * Set an item to Done in the working tree, and commit that one file unless told not to.
 * @param {string} root @param {Layout} layout @param {string} id
 * @param {{ commit?: boolean }} [options]
 * @returns {{ commit: string | null, branch: string | null, path: string, version: string }}
 */
export function closeItem(root, layout, id, { commit = true } = {}) {
  const entry = findEntry(root, layout, id);
  if (!entry?.data) throw new Error(`${id} is not in this working tree`);
  const d = entry.data;
  const here = currentBranch(root);
  const solo = d.kind === 'decision' || d.kind === 'external';
  if (d.kind === 'project' || d.kind === 'initiative') {
    throw new Error(`${id} is a ${d.kind}; its lead moves its status by editing the file`);
  }
  if (d.status === 'Done') throw new Error(`${id} is already Done`);
  if (d.status !== 'In progress' && !(solo && d.status === 'Planned')) {
    throw new Error(
      `${id} is ${d.status}; close an item that this branch claimed (In progress)${solo ? ', or a Planned decision or external item' : ''}`,
    );
  }
  if (!solo && here === layout.mainBranch) {
    throw new Error(`close ${id} in the branch that does the work, not on ${layout.mainBranch}`);
  }
  const stored = applyPatch(entry.data, { status: 'Done' }, layout);
  const version = writeStored(root, layout, entry.path, stored, entry.body);
  const claimant = String(d.claimed ?? '');
  const sha = commit
    ? commitOnly(root, [entry.path], { subject: `close: ${id}`, body: trailers(id, claimant) })
    : null;
  return { commit: sha, branch: here, path: entry.path, version };
}

/**
 * Release an abandoned claim with a commit on the main branch that records why. The commit is
 * empty when main already shows the item Planned, as it should; it carries the claim branch and
 * claim commit so `findClaims` stops counting the claim.
 * @param {string} root @param {Layout} layout @param {string} id @param {string} reason
 * @param {{ branch?: string }} [options] release only the claim on this branch
 * @returns {{ commit: string, branch: string, released: { claimant: string, branch: string, commit: string | null }[] }}
 */
export function releaseClaim(root, layout, id, reason, { branch } = {}) {
  if (!reason.trim()) throw new Error('a release needs a reason');
  const here = currentBranch(root);
  if (here !== layout.mainBranch) {
    throw new Error(
      `release on ${layout.mainBranch}, in the orchestrator's working tree (this is ${here})`,
    );
  }
  const item = findClaims(root, layout).find((c) => c.id === id);
  const claims = (item?.claims ?? []).filter((c) => !branch || c.branch === branch);
  if (!claims.length) throw new Error(`${id} has no live claim${branch ? ` on ${branch}` : ''}`);
  const entry = findEntry(root, layout, id);
  /** @type {string[]} */
  const files = [];
  if (entry?.data?.status === 'In progress') {
    const stored = applyPatch(entry.data, { status: 'Planned', claimed: null }, layout);
    writeStored(root, layout, entry.path, stored, entry.body);
    files.push(entry.path);
  }
  const lines = [
    `Reason: ${reason.trim()}`,
    '',
    `Work-Item: ${id}`,
    ...claims.flatMap((c) => [
      `Claim-Branch: ${c.branch}`,
      ...(c.commit ? [`Claim-Commit: ${c.commit}`] : []),
    ]),
  ];
  const message = `release: ${id}\n\n${lines.join('\n')}\n`;
  if (files.length) {
    git(root, [
      'commit',
      '--only',
      '--no-verify',
      '-m',
      `release: ${id}`,
      '-m',
      lines.join('\n'),
      '--',
      ...files,
    ]);
  } else {
    // An empty commit that leaves the index and the working tree alone: a commit with the same
    // tree as HEAD, then HEAD's branch moved onto it.
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    const made = git(root, ['commit-tree', `${head}^{tree}`, '-p', head, '-m', message]).trim();
    git(root, [
      'update-ref',
      '-m',
      `release: ${id}`,
      `refs/heads/${layout.mainBranch}`,
      made,
      head,
    ]);
  }
  return {
    commit: git(root, ['rev-parse', 'HEAD']).trim(),
    branch: here,
    released: claims.map((c) => ({ claimant: c.claimant, branch: c.branch, commit: c.commit })),
  };
}
