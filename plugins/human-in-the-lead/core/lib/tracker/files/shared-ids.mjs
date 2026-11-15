// Where a new ID is checked beyond this clone (design part 3.4, ID allocation). Two sessions on
// two machines each have their own copy of main, so the next number in one copy may already be
// taken in the other. Before a number is taken:
//
//   origin    the main branch's remote is fetched, so the numbers on its main and on every open
//             branch it holds are counted with the local ones (ids.mjs scans the remote-tracking
//             branches). A fetch that fails is a warning: the numbers last fetched still count.
//   counter   when the private store has a remote, the number is taken from the counter on the
//             store repository (remote-git.mjs, hitld-ids): a compare and swap that every
//             session with the store shares, so two sessions filing at once get different
//             numbers even when neither has pushed its file. A counter that cannot be reached
//             refuses the create (`id-counter-unreachable`): an ID that might collide is worse
//             than none.
//
// The duplicate check (check.mjs, and the merge queue's) is the backstop for anything else.

import { spawnSync } from 'node:child_process';
import { CodedError } from '../../cli/errors.mjs';
import { chooseRemote } from '../../store/address.mjs';
import { ensureRepo } from '../../store/git.mjs';
import { createIdCounter, remoteDir } from '../../store/remote-git.mjs';
import { privateStorePath } from '../../store/store.mjs';
import { git } from './tree.mjs';

/**
 * @typedef {import('./config.mjs').Layout} Layout
 *
 * @typedef {object} SharedIds what a create checks beyond this clone
 * @property {() => { warnings: string[] }} prepare fetch origin; called once per create
 * @property {((request: { key: string, block: string, from: number }) => number) | null} take
 *   the store counter, or null when the store has no remote
 * @property {'store-counter' | 'origin' | 'local'} source what the number is checked against
 */

/** How long a fetch of origin may take before it counts as failed. */
const FETCH_TIMEOUT_MS = 60_000;

/**
 * The remote the main branch tracks: its configured remote, else `origin` when there is one.
 * @param {string} root @param {Layout} layout @returns {string | null}
 */
export function mainRemote(root, layout) {
  const configured = git(root, ['config', '--get', `branch.${layout.mainBranch}.remote`], {
    allowFail: true,
  }).trim();
  const remotes = git(root, ['remote'], { allowFail: true }).split('\n').filter(Boolean);
  if (configured && configured !== '.' && remotes.includes(configured)) return configured;
  return remotes.includes('origin') ? 'origin' : null;
}

/**
 * Fetch the main branch's remote, so its main and its open branches are counted.
 * @param {string} root @param {string} remote
 * @returns {string | null} a warning when the fetch failed
 */
export function fetchRemote(root, remote) {
  const r = spawnSync('git', ['fetch', '--quiet', '--no-tags', remote], {
    cwd: root,
    encoding: 'utf8',
    timeout: FETCH_TIMEOUT_MS,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.status === 0) return null;
  const why = String(r.stderr ?? r.error?.message ?? '')
    .trim()
    .split('\n')
    .at(-1);
  return `could not fetch ${remote} (${why || 'no reason given'}), so only the numbers on it as last fetched were counted`;
}

/**
 * What a create in this clone checks beyond it: origin always, the store counter when the
 * private store has a remote.
 * @param {{ root: string, layout: Layout, policy: Record<string, any>, env: NodeJS.ProcessEnv }} o
 * @returns {SharedIds}
 */
export function sharedIds(o) {
  const projectId = String(o.policy?.project?.id ?? '');
  /** @type {string | null} */
  let storeRoot = null;
  try {
    storeRoot = projectId ? privateStorePath(projectId, { env: o.env }) : null;
  } catch {
    storeRoot = null; // no safe store directory: nothing of the store is read
  }
  const choice = storeRoot ? chooseRemote({ store: storeRoot, projectId, env: o.env }) : null;
  const remote = mainRemote(o.root, o.layout);
  /** @type {SharedIds['take']} */
  let take = null;
  if (choice && storeRoot) {
    const root = storeRoot;
    take = (request) => {
      try {
        // The counter's local copy lives inside the store's .git: make the repository first.
        ensureRepo(root);
        return createIdCounter({ url: choice.url, dir: remoteDir(root) }).take(request);
      } catch (e) {
        const err = /** @type {{ code?: unknown, message?: string }} */ (e);
        throw new CodedError(
          'id-counter-unreachable',
          `no ID was taken: the store repository holds the ID counter every session shares, and taking a number from it failed (${String(err.code ?? 'failed')}: ${err.message ?? String(e)}). Try again once the store's remote is reachable`,
        );
      }
    };
  }
  return {
    prepare: () => {
      const warning = remote ? fetchRemote(o.root, remote) : null;
      return { warnings: warning ? [warning] : [] };
    },
    take,
    source: take ? 'store-counter' : remote ? 'origin' : 'local',
  };
}
