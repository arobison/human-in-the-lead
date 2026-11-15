// ID allocation (design part 3.4, "ID allocation"):
//
// 1. Only the orchestrator allocates IDs, on the main branch, in its own working tree. Executors
//    never create tracker entities.
// 2. A second machine allocates from a reserved block, a range recorded in policy.json
//    (ids.blocks), so items created on either machine merge without renumbering.
// 3. The number comes from a source every session shares, not only this clone (shared-ids.mjs):
//    the main branch's remote is fetched first, and when the private store has a remote, the
//    number is taken from the store repository's counter, a compare and swap.
// 4. The check fails on duplicate IDs, in `hitld work check` and in the merge queue, as a
//    backstop (check.mjs).
//
// The next number is one more than the highest taken in the block's range, in every worktree's
// working copy (uncommitted files included) and on every local branch, remote-tracking branch
// and bundle ref; with a counter, it is also above every number the counter gave out. The file is created exclusively and the places are
// scanned once more, which narrows the window for two creates at the same instant in one clone
// to nothing but a tie, which the lexically smaller file name wins; the duplicate check catches
// anything else.

import { blockRange } from './config.mjs';
import { fileNamesIn, git, listPlaces, patterns } from './tree.mjs';
import { CodedError } from '../../cli/errors.mjs';

/**
 * @typedef {import('./config.mjs').Layout} Layout
 */

/**
 * Refuse to allocate unless this is the orchestrator: on the main branch, and not an executor.
 * An executor's environment sets HITLD_ROLE=executor (piece (h) does this at dispatch).
 * @param {string} root @param {Layout} layout @param {NodeJS.ProcessEnv} [env]
 */
export function assertOrchestrator(root, layout, env = process.env) {
  if (env.HITLD_ROLE === 'executor') {
    throw new CodedError(
      'not-permitted',
      'only the orchestrator creates tracker entities; an executor describes new work in its report',
    );
  }
  const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true }).trim();
  if (branch !== layout.mainBranch) {
    throw new CodedError(
      'not-permitted',
      `only the orchestrator creates tracker entities, on ${layout.mainBranch} in its own working tree (this is ${branch || 'a detached HEAD'})`,
    );
  }
}

/**
 * Every number taken in the range, anywhere in this clone.
 * @param {string} root @param {Layout} layout
 * @param {{ from: number, to: number | null }} range
 * @returns {Set<number>}
 */
export function takenNumbers(root, layout, range) {
  const { file: filePattern } = patterns(layout.key);
  const taken = new Set();
  for (const p of listPlaces(root, layout, { remotes: true })) {
    for (const f of fileNamesIn(root, layout, p)) {
      const n = Number(filePattern.exec(f)?.[1].slice(layout.key.length + 1));
      if (n >= range.from && (range.to === null || n <= range.to)) taken.add(n);
    }
  }
  return taken;
}

/**
 * Pick the next number in a block and call `write(n)`, which creates the file exclusively and
 * returns its repository-relative path. Then scan again: if another file took the same number
 * meanwhile, the one whose name sorts first keeps it and the other is removed (`remove(path)`)
 * and retried. `shared.take`, the store counter, takes the number (at least the next free one
 * here) for every session that shares the store.
 * A number the counter gives that is already in use here is refused and the next one taken.
 * @param {string} root @param {Layout} layout
 * @param {{ block?: string, write: (n: number) => string, remove: (path: string) => void, tries?: number,
 *   shared?: Pick<import('./shared-ids.mjs').SharedIds, 'take'> }} options
 * @returns {{ id: string, path: string, block: string }}
 */
export function allocate(root, layout, { block, write, remove, tries = 8, shared }) {
  const range = blockRange(layout, block);
  const { file: filePattern } = patterns(layout.key);
  for (let i = 0; i < tries; i++) {
    const taken = takenNumbers(root, layout, range);
    const next = Math.max(range.from - 1, ...taken) + 1;
    const n = shared?.take ? shared.take({ key: layout.key, block: range.name, from: next }) : next;
    if (range.to !== null && n > range.to) {
      throw new Error(
        `ID block "${range.name}" (${range.from} to ${range.to}) is used up; reserve a larger block in policy.json ids.blocks`,
      );
    }
    if (taken.has(n)) continue; // the counter is behind: that number is in use
    /** @type {string} */
    let path;
    try {
      path = write(n);
    } catch (e) {
      if (/** @type {{ code?: string }} */ (e).code === 'EEXIST') continue;
      throw e;
    }
    const mine = path.split('/').pop() ?? '';
    const rivals = listPlaces(root, layout, { remotes: true })
      .flatMap((p) => fileNamesIn(root, layout, p))
      .filter(
        (f) => Number(filePattern.exec(f)?.[1].slice(layout.key.length + 1)) === n && f !== mine,
      );
    if (rivals.some((f) => f < mine)) {
      remove(path);
      continue;
    }
    return { id: `${layout.key}-${n}`, path, block: range.name };
  }
  throw new Error("couldn't allocate a number; try again");
}
