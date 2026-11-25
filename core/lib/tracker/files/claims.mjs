// Claims, closing and unclaiming (design part 3.4, "Claims and closing").
//
// - A claim is the first commit of the executor's branch: it changes only the item file, to
//   `state: in-progress` and `claimed_by: <dispatch ID>`, with the message `claim: <ID>`. Only a
//   work item is claimed: decisions, external items and milestones have no in-progress state.
// - The branch is where the claim lives. The main branch never shows a work item in-progress, so
//   which items are claimed is read from branches: local ones, remote-tracking ones and the ref
//   prefixes where a second machine's bundles are fetched.
// - Closing rides with the work: a commit on the same branch sets `state: done`. Merging the
//   branch closes the item.
// - An abandoned claim is given up (unclaimed) by the orchestrator with a commit on the main
//   branch whose message starts `unclaim:`, naming the branch and the claim commit and recording
//   why. The commit may be empty: main already shows the item planned. A claim whose commit an
//   unclaim commit names stops counting. Commits from before HITLD-82 start `release:`; the scan
//   still reads them.
// - Claim branches made before HITLD-82 hold the old keys (`status: In progress`, `claimed:`);
//   the branches are read through `fromLegacy` (tree.mjs), so those claims still count.
//
// Claim and close commits carry `Work-Item:` and `Dispatch:`; the executor's own commits add the
// `Agent-*` trailers (the owner's answer to Q5, 2026-11-14)
// (design part 22). Nothing here pushes.

import { applyPatch } from './format.mjs';
import { findEntry, writeKeys, writeStored } from './edit.mjs';
import { git, idNumber, loadPlaces, refPlaces } from './tree.mjs';
import { CodedError } from '../../cli/errors.mjs';
import { DISPATCH_ID } from '../../ledger/ids.mjs';

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry} Entry
 *
 * @typedef {object} Claim
 * @property {string} claimant the `claimed_by` value: a dispatch ID, a session or a person's handle
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
export function mainRef(root, layout) {
  const ref = `refs/heads/${layout.mainBranch}`;
  return git(root, ['rev-parse', '--verify', '-q', ref], { allowFail: true }).trim() ? ref : null;
}

/**
 * Claim commits that an unclaim commit on the main branch has retired, by their hashes. A commit
 * from before HITLD-82 starts `release:` and counts the same.
 * @param {string} root @param {Layout} layout
 * @returns {Set<string>}
 */
export function unclaimedClaims(root, layout) {
  const main = mainRef(root, layout);
  if (!main) return new Set();
  const log = git(root, ['log', main, '-E', '--grep=^(unclaim|release): ', '--format=%B%x1e'], {
    allowFail: true,
  });
  return new Set([...log.matchAll(/^Claim-Commit: ([0-9a-f]{7,64})\s*$/gm)].map((m) => m[1]));
}

/**
 * The claim commit on a ref for each item asked about: the first commit since the main branch
 * that touches the item's file with a message line `claim: <ID>`, or failing that the oldest
 * commit touching its file. One `git log` per ref, however many items it claims, since starting a
 * process is slow on some machines.
 * @param {string} root @param {string | null} main the main branch's ref
 * @param {{ ref: string, id: string, path: string }[]} wanted
 * @returns {Map<string, { commit: string, at: string }>} keyed by `${ref}\0${id}`
 */
function claimCommits(root, main, wanted) {
  /** @type {Map<string, { commit: string, at: string }>} */
  const found = new Map();
  /** @type {Map<string, { id: string, path: string }[]>} */
  const byRef = new Map();
  for (const w of wanted) byRef.set(w.ref, [...(byRef.get(w.ref) ?? []), w]);
  for (const [ref, items] of byRef) {
    const range = main ? [`${main}..${ref}`] : [ref];
    const paths = [...new Set(items.map((w) => w.path))];
    const log = git(
      root,
      [
        'log',
        ...range,
        '--reverse',
        '--format=%x1e%H %cI%x1f%B%x1f',
        '--name-only',
        '--',
        ...paths,
      ],
      { allowFail: true },
    );
    // Oldest first: "\x1e<commit> <date>\x1f<message>\x1f" and the paths it touched, one a line.
    const commits = log
      .split('\x1e')
      .slice(1)
      .map((chunk) => {
        const [head = '', message = '', names = ''] = chunk.split('\x1f');
        const [commit, at] = head.trim().split(' ');
        return {
          commit,
          at,
          lines: message.split('\n').map((l) => l.trimEnd()),
          paths: new Set(names.split('\n').map((p) => p.trim())),
        };
      });
    for (const { id, path } of items) {
      const touching = commits.filter((c) => c.paths.has(path));
      const c = touching.find((t) => t.lines.includes(`claim: ${id}`)) ?? touching[0];
      if (c) found.set(`${ref}\0${id}`, { commit: c.commit, at: c.at });
    }
  }
  return found;
}

/**
 * Claims read from branches: every item that is in-progress on a ref other than the main branch
 * where the main branch's copy differs (it shows it planned). Claims an unclaim commit has retired
 * do not count.
 * @param {string} root @param {Layout} layout
 * @param {{ cache?: Map<string, import('./tree.mjs').Entry[]> }} [options] cache: refs already
 *   read by the same command (see loadPlaces)
 * @returns {ClaimedItem[]}
 */
export function findClaims(root, layout, { cache } = {}) {
  const main = mainRef(root, layout);
  const refs = refPlaces(root, layout).filter(
    (p) => p.ref !== main && !(p.ref ?? '').endsWith(`/${layout.mainBranch}`),
  );
  // The main branch and every other ref, read together.
  const placed = loadPlaces(
    root,
    layout,
    [...(main ? [{ where: layout.mainBranch, ref: main }] : []), ...refs],
    { cache },
  );
  const mainItems = main
    ? new Map((placed.shift()?.items ?? []).map((e) => [String(e.data?.id), e.data]))
    : new Map();
  const unclaimed = unclaimedClaims(root, layout);
  // Items in-progress on a ref where the main branch's copy differs.
  const candidates = placed.flatMap(({ ref, items }) =>
    items
      .filter((it) => {
        const d = it.data;
        if (!d?.id || d.state !== 'in-progress' || d.kind === 'project' || d.kind === 'milestone') {
          return false;
        }
        const here = mainItems.get(String(d.id));
        return !(here && here.state === d.state && here.claimed_by === d.claimed_by); // not news
      })
      .map((it) => ({ ref: String(ref), it })),
  );
  const commits = claimCommits(
    root,
    main,
    candidates.map(({ ref, it }) => ({ ref, id: String(it.data?.id), path: it.path })),
  );
  /** @type {Map<string, ClaimedItem>} */
  const claimed = new Map();
  for (const { ref, it } of candidates) {
    const d = /** @type {NonNullable<typeof it.data>} */ (it.data);
    const id = String(d.id);
    const found = commits.get(`${ref}\0${id}`);
    if (
      found &&
      [...unclaimed].some((r) => found.commit.startsWith(r) || r.startsWith(found.commit))
    ) {
      continue;
    }
    if (!claimed.has(id)) {
      claimed.set(id, { id, title: String(d.title), claims: [], double: false });
    }
    /** @type {ClaimedItem} */ (claimed.get(id)).claims.push({
      claimant: String(d.claimed_by ?? '?'),
      branch: ref.replace(/^refs\/(heads|remotes)\//, ''),
      ref,
      commit: found?.commit ?? null,
      at: found?.at ?? null,
      source: sourceOf(layout, ref),
    });
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
 * Only claimants that are dispatch IDs (`D-<n>` of before, or unique ones: ledger/ids.mjs) are matched; a person's handle is not a dispatch.
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
      if (DISPATCH_ID.test(cl.claimant) && !open.has(cl.claimant)) {
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

/** The largest token cap a claim carries: twelve digits, as the budget hook reads it. */
export const MAX_BUDGET_TOKENS = 999_999_999_999;

/** @param {string} id @param {string} claimant @param {number | null} [budget] */
const trailers = (id, claimant, budget = null) =>
  [
    `Work-Item: ${id}`,
    ...(DISPATCH_ID.test(claimant) ? [`Dispatch: ${claimant}`] : []),
    ...(budget ? [`Budget-Tokens: ${budget}`] : []),
  ].join('\n');

/**
 * Write the claim commit for an item on the current (executor) branch.
 * @param {string} root @param {Layout} layout @param {string} id @param {string} claimant
 * @param {{ branch?: string, budgetTokens?: number | null }} [options] branch: refuse unless HEAD
 *   is on it; budgetTokens: the dispatch's token cap, written as a `Budget-Tokens` trailer so the
 *   budget hook can read it where there is no private store (HITLD-841)
 * @returns {{ commit: string, branch: string }}
 */
export function claimItem(root, layout, id, claimant, { branch, budgetTokens = null } = {}) {
  const here = currentBranch(root);
  if (!here) throw new Error('claim from a branch, not a detached HEAD');
  if (here === layout.mainBranch) {
    throw new CodedError(
      'not-permitted',
      `claim on the executor's branch, never on ${layout.mainBranch}`,
    );
  }
  if (branch && branch !== here) throw new Error(`this working tree is on ${here}, not ${branch}`);
  if (!claimant.trim()) throw new Error('a claim needs a claimant (a dispatch ID)');
  // At most twelve digits: the budget hook reads no longer figure (hooks/input.mjs).
  if (
    budgetTokens !== null &&
    !(Number.isSafeInteger(budgetTokens) && budgetTokens > 0 && budgetTokens <= MAX_BUDGET_TOKENS)
  ) {
    throw new CodedError(
      'usage',
      `a token cap is a whole number of tokens from 1 to ${MAX_BUDGET_TOKENS}`,
    );
  }
  const entry = findEntry(root, layout, id);
  if (!entry?.data) throw new CodedError('not-found', `${id} is not in this working tree`);
  const d = entry.data;
  if (d.kind !== 'work') {
    throw new Error(
      `${id} is a ${d.kind}; only a work item is claimed (decisions, external items and milestones have no in-progress state)`,
    );
  }
  if (d.state !== 'planned') {
    throw new Error(`${id} is ${d.state}; only a planned item can be claimed`);
  }
  for (const c of findClaims(root, layout)) {
    if (c.id === id) {
      const by = c.claims.map((x) => `${x.claimant} on ${x.branch}`).join('; ');
      throw new Error(`${id} is already claimed by ${by}`);
    }
  }
  const stored = applyPatch(entry.data, { state: 'in-progress', claimed_by: claimant }, layout);
  writeStored(root, layout, entry.path, stored, entry.body);
  const commit = commitOnly(root, [entry.path], {
    subject: `claim: ${id}`,
    body: trailers(id, claimant, budgetTokens),
  });
  return { commit, branch: here };
}

/**
 * Set an item to done in the working tree, and commit that one file unless told not to.
 * @param {string} root @param {Layout} layout @param {string} id
 * @param {{ commit?: boolean, report?: string }} [options] report: the executor's report in the
 *   fixed shape, written into the closing commit's message body
 * @returns {{ commit: string | null, branch: string | null, path: string, version: string }}
 */
export function closeItem(root, layout, id, { commit = true, report } = {}) {
  const entry = findEntry(root, layout, id);
  if (!entry?.data) throw new CodedError('not-found', `${id} is not in this working tree`);
  const d = entry.data;
  const here = currentBranch(root);
  const solo = d.kind === 'decision' || d.kind === 'external';
  if (d.kind === 'project') {
    throw new Error(`${id} is a ${d.kind}; whether it is active is derived from its items`);
  }
  if (d.kind === 'milestone') {
    throw new Error(`${id} is a milestone; it is done only by a passing check, never closed`);
  }
  if (d.state === 'done') throw new Error(`${id} is already done`);
  if (d.state !== 'in-progress' && !(solo && d.state === 'planned')) {
    throw new Error(
      `${id} is ${d.state}; close an item that this branch claimed (in-progress)${solo ? ', or a planned decision or external item' : ''}`,
    );
  }
  if (!solo && here === layout.mainBranch) {
    throw new CodedError(
      'not-permitted',
      `close ${id} in the branch that does the work, not on ${layout.mainBranch}`,
    );
  }
  // Only the state line changes; the other keys stay where the file has them (HITLD-261).
  const stored = applyPatch(entry.data, { state: 'done' }, layout);
  const version = writeKeys(root, layout, entry.path, stored, ['state']);
  const claimant = String(d.claimed_by ?? '');
  // The report rides in the closing commit's body, before its trailers (HITLD-746): the commit
  // is the report, which `hitld dispatch reconcile` reads from the branch head (HITLD-780).
  const told = typeof report === 'string' ? report.replace(/\r\n?/g, '\n').trim() : '';
  const sha = commit
    ? commitOnly(root, [entry.path], {
        subject: `close: ${id}`,
        body: told ? `${told}\n\n${trailers(id, claimant)}` : trailers(id, claimant),
      })
    : null;
  return { commit: sha, branch: here, path: entry.path, version };
}

/**
 * Give up (unclaim) an abandoned claim with a commit on the main branch that records why. The
 * commit is empty when main already shows the item planned, as it should; it carries the claim
 * branch and claim commit so `findClaims` stops counting the claim.
 * @param {string} root @param {Layout} layout @param {string} id @param {string} reason
 * @param {{ branch?: string }} [options] unclaim only the claim on this branch
 * @returns {{ commit: string, branch: string, unclaimed: { claimant: string, branch: string, commit: string | null }[] }}
 */
export function unclaimItem(root, layout, id, reason, { branch } = {}) {
  if (!reason.trim()) throw new Error('an unclaim needs a reason');
  const here = currentBranch(root);
  if (here !== layout.mainBranch) {
    throw new Error(
      `unclaim on ${layout.mainBranch}, in the orchestrator's working tree (this is ${here})`,
    );
  }
  const item = findClaims(root, layout).find((c) => c.id === id);
  const claims = (item?.claims ?? []).filter((c) => !branch || c.branch === branch);
  if (!claims.length) throw new Error(`${id} has no live claim${branch ? ` on ${branch}` : ''}`);
  const entry = findEntry(root, layout, id);
  /** @type {string[]} */
  const files = [];
  if (entry?.data?.state === 'in-progress') {
    const stored = applyPatch(entry.data, { state: 'planned', claimed_by: null }, layout);
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
  const message = `unclaim: ${id}\n\n${lines.join('\n')}\n`;
  if (files.length) {
    git(root, [
      'commit',
      '--only',
      '--no-verify',
      '-m',
      `unclaim: ${id}`,
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
      `unclaim: ${id}`,
      `refs/heads/${layout.mainBranch}`,
      made,
      head,
    ]);
  }
  return {
    commit: git(root, ['rev-parse', 'HEAD']).trim(),
    branch: here,
    unclaimed: claims.map((c) => ({ claimant: c.claimant, branch: c.branch, commit: c.commit })),
  };
}
