// `hitld work migrate`: structural changes to the whole tracker (design parts 3.4 and 16.5).
//
// A migration is a registered, named step. It is a pure function from the tracker's files to the
// changes that bring them to the new format, and it returns no changes for files already in it,
// so running it twice changes nothing (it is idempotent) and `hitld work check` can name the files
// that still need it. The runner plans every step in memory, one after the other (each sees the
// result of the one before), checks the outcome, and only then writes. A dry run stops before
// writing and shows the diff. A real run writes the files and, unless told not to, commits them in
// one commit that can be reviewed.
//
// Scope: ID-named files under the work directory (projects, items, milestones, and the initiatives
// folder the format had before HITLD-90). A step may change, create or delete those. A step that creates a file allocates its number from
// what the tree holds and what `taken` says is used elsewhere in the clone, so a run on one branch
// does not reuse a number another branch already holds. tracker.json is changed by the owner, not
// by a migration; release records are written by `hitld release make`, never by a migration.

import { rmSync } from 'node:fs';
import { checkItems } from './check.mjs';
import { parseItem } from './frontmatter.mjs';
import {
  createExclusive,
  insidePath,
  isRegularFile,
  mkdirInside,
  readNoFollow,
  writeNoFollow,
} from './safe.mjs';
import { assertOrchestrator, takenNumbers } from './ids.mjs';
import { blockRange } from './config.mjs';
import { folderNames, git, loadWorkTree } from './tree.mjs';
import { MIGRATIONS } from './migrations/index.mjs';

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry} Entry
 *
 * @typedef {object} MigrationTree what a step reads
 * @property {Layout} layout
 * @property {Entry[]} entries every item file, parsed, in path order
 * @property {Map<string, string>} files the same files as text, by repository-relative path
 * @property {Set<number>} taken numbers used anywhere in this clone (worktrees, branches, bundle
 *   refs) within `range`; empty when only checking whether work is left
 * @property {{ from: number, to: number | null }} range the base ID range new files take numbers from
 *
 * @typedef {object} FileChange one file a step changes
 * @property {string} path repository-relative, an ID-named file under the work directory
 * @property {string | null} text the new text; null deletes the file; a new path creates it
 *
 * @typedef {object} Migration
 * @property {string} name lower case words joined by hyphens; unique; never renamed once released
 * @property {string} summary one sentence: what changes
 * @property {(tree: MigrationTree) => FileChange[]} plan the changes needed; none when the
 *   tracker is already in the new format. Reads nothing but `tree`.
 *
 * @typedef {object} PlannedFile
 * @property {string} path
 * @property {'create' | 'change' | 'delete'} action
 * @property {string} diff
 *
 * @typedef {object} PlannedStep
 * @property {string} name
 * @property {string} summary
 * @property {PlannedFile[]} files
 */

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Parse a files map into entries, as loadWorkTree would.
 * @param {Map<string, string>} files
 * @returns {Entry[]}
 */
function entriesOf(files) {
  return [...files.keys()].sort().map((path) => {
    const parts = path.split('/');
    return {
      path,
      file: parts[parts.length - 1],
      folder: parts[parts.length - 2],
      ...parseItem(/** @type {string} */ (files.get(path))),
    };
  });
}

/**
 * A step's view of the files.
 * @param {Map<string, string>} files @param {Layout} layout @param {Set<number>} [taken]
 * @returns {MigrationTree}
 */
const treeOf = (files, layout, taken = new Set()) => ({
  layout,
  entries: entriesOf(files),
  files: new Map(files),
  taken,
  range: blockRange(layout, undefined),
});

/**
 * Whether a path is a file a migration may touch: an ID-named file in one of the folders.
 * @param {Layout} layout @param {string} path
 */
function allowedPath(layout, path) {
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return false;
  const parts = path.split('/');
  const work = layout.workDir.split('/');
  if (parts.length !== work.length + 2) return false;
  if (work.some((w, i) => parts[i] !== w)) return false;
  return (
    folderNames(layout).includes(parts[work.length]) && /^[^/]+\.md$/.test(parts[parts.length - 1])
  );
}

/**
 * A line diff: changed lines marked `-` and `+`, with one line of context and `...` between
 * hunks. Item files are small, so the quadratic table is fine.
 * @param {string | null} before @param {string | null} after
 */
export function lineDiff(before, after) {
  const a = before === null ? [] : before.split('\n');
  const b = after === null ? [] : after.split('\n');
  /** @type {number[][]} */
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  /** @type {{ mark: ' ' | '-' | '+', line: string }[]} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ mark: ' ', line: a[i] });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || t[i][j + 1] > t[i + 1][j])) {
      ops.push({ mark: '+', line: b[j++] });
    } else {
      ops.push({ mark: '-', line: a[i++] });
    }
  }
  const keep = ops.map(() => false);
  ops.forEach((o, k) => {
    if (o.mark === ' ') return;
    for (const near of [k - 1, k, k + 1]) if (near >= 0 && near < ops.length) keep[near] = true;
  });
  /** @type {string[]} */
  const out = [];
  let gap = false;
  ops.forEach((o, k) => {
    if (!keep[k]) {
      gap = out.length > 0;
      return;
    }
    if (gap) out.push('...');
    gap = false;
    out.push(`${o.mark}${o.line}`);
  });
  return out.join('\n');
}

/**
 * Apply a step's changes to the in-memory files, and describe them.
 * @param {Map<string, string>} files @param {Layout} layout @param {string} name
 * @param {FileChange[]} changes
 * @returns {PlannedFile[]}
 */
function apply(files, layout, name, changes) {
  /** @type {PlannedFile[]} */
  const out = [];
  const seen = new Set();
  for (const c of changes) {
    if (!allowedPath(layout, c.path)) {
      throw new Error(
        `migration "${name}" names ${JSON.stringify(c.path)}, which is not a tracker file`,
      );
    }
    if (seen.has(c.path)) throw new Error(`migration "${name}" changes ${c.path} twice`);
    seen.add(c.path);
    const had = files.get(c.path) ?? null;
    if (c.text === had) continue;
    if (c.text === null) files.delete(c.path);
    else files.set(c.path, c.text);
    out.push({
      path: c.path,
      action: had === null ? 'create' : c.text === null ? 'delete' : 'change',
      diff: lineDiff(had, c.text),
    });
  }
  return out;
}

/** @param {readonly Migration[]} migrations */
function checkRegistry(migrations) {
  const names = new Set();
  for (const m of migrations) {
    if (!NAME.test(m.name)) {
      throw new Error(`migration name ${JSON.stringify(m.name)} is not valid`);
    }
    if (names.has(m.name)) throw new Error(`migration "${m.name}" is registered twice`);
    names.add(m.name);
  }
  return names;
}

/**
 * An item file's text with LF line endings, as the migrations match it. A Windows checkout with
 * `core.autocrlf` has CRLF; without this, no front matter is found and every file is skipped.
 * @param {string} root @param {string} path
 */
const readText = (root, path) => readNoFollow(insidePath(root, path)).replace(/\r\n/g, '\n');

/**
 * Plan migrations in memory. Nothing is written.
 * @param {string} root @param {Layout} layout
 * @param {{ migrations?: readonly Migration[], only?: string }} [options]
 *   migrations: the registry (default: the registered ones); only: run just the named step
 */
export function planMigrations(root, layout, { migrations = MIGRATIONS, only } = {}) {
  const names = checkRegistry(migrations);
  if (only !== undefined && !names.has(only)) {
    throw new Error(
      `no migration named "${only}" (registered: ${[...names].join(', ') || 'none'})`,
    );
  }
  const loaded = loadWorkTree(root, layout);
  /** @type {Map<string, string>} */
  const original = new Map(loaded.map((e) => [e.path, readText(root, e.path)]));
  const files = new Map(original);
  const before = checkItems(loaded, layout, { root });
  const taken = takenNumbers(root, layout, blockRange(layout, undefined));
  /** @type {PlannedStep[]} */
  const steps = [];
  for (const m of migrations) {
    if (only !== undefined && m.name !== only) continue;
    const planned = apply(files, layout, m.name, m.plan(treeOf(files, layout, taken)));
    steps.push({ name: m.name, summary: m.summary, files: planned });
    // A step with work left after its own changes would never settle.
    const again = m.plan(treeOf(files, layout, taken));
    if (again.length) {
      throw new Error(
        `migration "${m.name}" is not idempotent: it still wants to change ${again.map((c) => c.path).join(', ')} after its own changes`,
      );
    }
  }
  const after = checkItems(entriesOf(files), layout, { root });
  return { steps, files, original, problems: after.filter((p) => !before.includes(p)) };
}

/**
 * Run migrations over a tracker: plan, check the outcome, then write and commit.
 * @param {string} root @param {Layout} layout
 * @param {{ migrations?: readonly Migration[], only?: string, dryRun?: boolean, commit?: boolean, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ dry_run: boolean, migrations: PlannedStep[], changed: number, commit: string | null }}
 */
export function migrateTracker(root, layout, { dryRun = false, commit = true, env, ...rest } = {}) {
  const plan = planMigrations(root, layout, rest);
  if (plan.problems.length) {
    throw new Error(`not migrated: the result would fail the check: ${plan.problems.join('; ')}`);
  }
  const paths = [...new Set(plan.steps.flatMap((s) => s.files.map((f) => f.path)))];
  if (dryRun || paths.length === 0) {
    return { dry_run: dryRun, migrations: plan.steps, changed: paths.length, commit: null };
  }
  assertOrchestrator(root, layout, env);
  if (commit && git(root, ['status', '--porcelain', '--', layout.workDir]).trim()) {
    throw new Error(
      `${layout.workDir}/ has uncommitted changes; commit or discard them first, so the migration commit holds only the migration (or pass --no-commit)`,
    );
  }
  for (const path of paths) {
    const text = plan.files.get(path);
    const full = insidePath(root, path);
    if (text === undefined) {
      if (isRegularFile(full)) rmSync(full);
    } else if (plan.original.has(path)) {
      writeNoFollow(full, text);
    } else {
      mkdirInside(root, path.slice(0, path.lastIndexOf('/')));
      createExclusive(full, text);
    }
  }
  let sha = null;
  if (commit) {
    git(root, ['add', '-A', '--', ...paths]);
    const names = plan.steps.filter((s) => s.files.length).map((s) => s.name);
    // Only the migration's own paths: anything else already staged (such as a design file that
    // `hitld work publish` staged on main, HITLD-202) stays staged and out of this commit.
    git(root, [
      'commit',
      '--only',
      '--no-verify',
      '-m',
      `migrate: ${names.join(', ')}`,
      '-m',
      plan.steps.map((s) => `${s.name}: ${s.summary}`).join('\n'),
      '--',
      ...paths,
    ]);
    sha = git(root, ['rev-parse', 'HEAD']).trim();
  }
  return { dry_run: false, migrations: plan.steps, changed: paths.length, commit: sha };
}

/**
 * One problem line per file that a registered migration still wants to change, for the check.
 * @param {string} root @param {Layout} layout
 * @param {{ migrations?: readonly Migration[] }} [options]
 * @returns {string[]}
 */
export function pendingMigrationProblems(root, layout, { migrations = MIGRATIONS } = {}) {
  if (migrations.length === 0) return [];
  checkRegistry(migrations);
  // A file that is not a regular file is the check's to name; it is never read here.
  const files = new Map(
    loadWorkTree(root, layout)
      .filter((e) => e.version !== undefined)
      .map((e) => [e.path, readText(root, e.path)]),
  );
  /** @type {string[]} */
  const out = [];
  for (const m of migrations) {
    for (const f of apply(files, layout, m.name, m.plan(treeOf(files, layout)))) {
      if (f.action === 'create') {
        out.push(`migration "${m.name}" would create a file (run hitld work migrate)`);
      } else out.push(`${f.path}: needs migration "${m.name}" (run hitld work migrate)`);
    }
  }
  return out;
}
