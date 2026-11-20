// The report check's release-note rule (HITLD-136): a done report whose branch changes the public
// interface (`merge.public_globs`) while its item carries no `release_note` is flagged. It flags;
// it does not refuse. Read from git as data: nothing on the branch runs.

import { git } from '../tracker/files/tree.mjs';
import { parseItem } from '../tracker/files/frontmatter.mjs';
import { matchesAny } from '../precedent/glob.mjs';

/**
 * The ref of the main branch, or HEAD when the repository has no such branch.
 * @param {string} repoRoot @param {string} main
 */
export function mainRefOf(repoRoot, main) {
  const ref = `refs/heads/${main}`;
  return git(repoRoot, ['rev-parse', '--verify', '-q', ref], { allowFail: true }).trim()
    ? ref
    : 'HEAD';
}

/**
 * The public files a commit changes against main, when its item at that commit has no
 * `release_note`; null when nothing is missing or git cannot tell.
 * @param {{ repoRoot: string, main: string, commit: string, itemPath?: string, publicGlobs: string[] }} o
 * @returns {{ files: string[] } | null}
 */
export function missingReleaseNote(o) {
  if (!o.publicGlobs.length || !/^[0-9a-f]{4,64}$/i.test(o.commit)) return null;
  const changed = git(o.repoRoot, ['diff', '--name-only', `${o.main}...${o.commit}`, '--'], {
    allowFail: true,
  })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  const files = changed.filter((f) => matchesAny(o.publicGlobs, f));
  if (!files.length) return null;
  if (o.itemPath) {
    const text = git(o.repoRoot, ['show', `${o.commit}:${o.itemPath}`], { allowFail: true });
    const note = parseItem(text).data?.release_note;
    if (typeof note === 'string' && note.trim()) return null;
  }
  return { files };
}
