// Which areas a change touches that have an invariant registry (design 6.3, step 2): the pass is
// due for each. A change is the branch's commits since it left the base, with uncommitted and
// untracked files.

import { execFileSync } from 'node:child_process';
import { matchesAny } from '../precedent/glob.mjs';

/** @param {string} root @param {string[]} args */
const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * The files a change touches, repository-relative, sorted.
 * @param {string} root @param {string} base a ref
 * @returns {string[]}
 */
export function changedFiles(root, base) {
  const from = git(root, ['merge-base', 'HEAD', base]).trim();
  const lines = [
    ...git(root, ['diff', '--name-only', '-z', from]).split('\0'),
    ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ];
  return [...new Set(lines.filter(Boolean))].sort();
}

/**
 * The registries a change touches: an area's globs match a changed file, or the registry itself
 * changed.
 * @param {import('./registry.mjs').Registry[]} regs @param {string[]} changed
 * @returns {{ registry: import('./registry.mjs').Registry, changed: string[] }[]}
 */
export function dueRegistries(regs, changed) {
  return regs
    .map((registry) => ({
      registry,
      changed: changed.filter((f) => f === registry.path || matchesAny(registry.paths, f)),
    }))
    .filter((d) => d.changed.length > 0);
}
