// A fresh worktree with nothing installed (HITLD-292). The merge queue runs merge.fast_checks and
// merge.full_suite in a fresh worktree of its own, which holds only what git tracks and what
// env.worktree_setup makes. A policy that sets those checks and no setup passes every check
// policy can make, then fails its first merge on a branch that did nothing wrong. Setup and check
// time (check policy, config explain, install) warn about it; the queue stops on it before it
// checks a branch, when a lockfile shows what the worktree lacks.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { globMatch } from '../precedent/glob.mjs';

/**
 * The lockfiles at a repository's root, in the order they are looked for, each with the install
 * command the adopt skill would propose for it and, when the install lands inside the worktree,
 * the directory it makes there (dependencies in a shared cache, as Go's and Cargo's, have none:
 * their checks fetch on demand).
 * @type {{ file: string, install: string, dir?: string }[]}
 */
export const LOCKFILES = [
  { file: 'package-lock.json', install: 'npm ci', dir: 'node_modules' },
  { file: 'npm-shrinkwrap.json', install: 'npm ci', dir: 'node_modules' },
  { file: 'pnpm-lock.yaml', install: 'pnpm install --frozen-lockfile', dir: 'node_modules' },
  { file: 'yarn.lock', install: 'yarn install --frozen-lockfile', dir: 'node_modules' },
  { file: 'bun.lock', install: 'bun install --frozen-lockfile', dir: 'node_modules' },
  { file: 'bun.lockb', install: 'bun install --frozen-lockfile', dir: 'node_modules' },
  { file: 'uv.lock', install: 'uv sync --frozen', dir: '.venv' },
  { file: 'poetry.lock', install: 'poetry install' },
  { file: 'Pipfile.lock', install: 'pipenv sync' },
  { file: 'Gemfile.lock', install: 'bundle install' },
  { file: 'Cargo.lock', install: 'cargo fetch' },
  { file: 'go.sum', install: 'go mod download' },
];

/** The first lockfile at `root`, if any. @param {string | null} root */
export const lockfileAt = (root) =>
  root ? (LOCKFILES.find((l) => existsSync(join(root, l.file))) ?? null) : null;

/** @param {{ file: string, install: string }} lock */
const propose = (lock) => `${lock.file} is here: propose "${lock.install}"`;

const ALSO =
  'and any command that makes the generated, uncommitted files the checks import, not only the install';

/**
 * The warning for a policy whose merge queue runs checks in a worktree its setup leaves empty, or
 * null. Only the local queue (merge.via push) runs them in its own worktree; with pull requests
 * the checks run where the pull request's checks do.
 * @param {{ merge?: { via?: string, fast_checks?: string[], full_suite?: string[] }, env?: { worktree_setup?: string[] } } | null} policy
 *   the effective policy
 * @param {string | null} root the repository's root, where a lockfile is looked for
 * @returns {string | null}
 */
export function worktreeSetupGap(policy, root) {
  if (!policy) return null;
  const merge = policy.merge ?? {};
  if ((merge.via ?? 'push') !== 'push') return null;
  if ((policy.env?.worktree_setup ?? []).length) return null;
  const set = [
    ...((merge.fast_checks ?? []).length ? ['merge.fast_checks'] : []),
    ...((merge.full_suite ?? []).length ? ['merge.full_suite'] : []),
  ];
  if (!set.length) return null;
  const lock = lockfileAt(root);
  return (
    `${set.join(' and ')} ${set.length > 1 ? 'are' : 'is'} set but env.worktree_setup is empty: ` +
    `the merge queue runs ${set.length > 1 ? 'these' : 'it'} in a fresh worktree with nothing installed; ` +
    `set env.worktree_setup in .human-in-the-lead/policy.json${lock ? ` (${propose(lock)})` : ''}, ${ALSO}`
  );
}

/**
 * Why the queue's fresh worktree cannot run the checks, or null: no setup, and a lockfile there
 * whose install directory is missing. Without a lockfile the queue cannot tell, and goes on.
 * @param {string} dir the fresh worktree @param {string[]} setup env.worktree_setup
 * @returns {string | null}
 */
export function emptyWorktree(dir, setup) {
  if (setup.length) return null;
  const lock = LOCKFILES.find((l) => l.dir && existsSync(join(dir, l.file)));
  if (!lock?.dir || existsSync(join(dir, lock.dir))) return null;
  return (
    `the merge queue's fresh worktree has no ${lock.dir} and env.worktree_setup is empty, so the checks cannot run there; ` +
    `nothing was checked or merged, and no branch is at fault. Set env.worktree_setup in .human-in-the-lead/policy.json ` +
    `(${propose(lock)}), ${ALSO}, then run hitld merge again`
  );
}

// Setup on the commit under test (HITLD-1054). The queue ran env.worktree_setup once, on main's
// tip, and only then checked out the branches it tests, so a branch that adds a package or changes
// the lockfile built in its executor's worktree and failed in the queue's. Setup runs on the commit
// checked out instead, and again only when the dependency manifests or lockfiles differ from those
// of the commit it last ran on: otherwise what it installed is reused.

/**
 * The dependency files (by name, in any folder) that differ between two commits, as their paths.
 * @param {string} dir a worktree of the repository @param {string} from @param {string} to
 * @param {Set<string>} names dependencyFileNames (merge/owner.mjs)
 * @returns {string[]}
 */
export function dependencyChanges(dir, from, to, names) {
  if (from === to) return [];
  const r = spawnSync('git', ['diff', '--name-only', '--no-renames', '-z', from, to], {
    cwd: dir,
    encoding: 'utf8',
  });
  // An unreadable diff counts as a change: setup runs again rather than reuse a stale install.
  if (r.status !== 0) return ['(unknown)'];
  return (r.stdout ?? '').split('\0').filter((f) => f && names.has(basename(f)));
}

/**
 * @typedef {{ kind: 'base' | 'batch', commit: string, files: string[] }} SetupRun one run of
 *   env.worktree_setup: on the batch's base (main, or a held batch the next is built on) or on a
 *   commit of the batch under test; files: the dependency files that differed from the commit it
 *   last ran on, none on the first run
 * @typedef {{ ok: true, ran: boolean } | { ok: false, command: string, output: string, files: string[] }} SetupOutcome
 */

/**
 * env.worktree_setup for the queue's worktree, run on whatever commit the caller has checked out.
 * `ensure` runs it when it has not run yet, when the last run failed, or when the dependency
 * files differ from those of the commit it last ran on; otherwise it reuses that run.
 * @param {{ dir: string, commands: string[], names: Set<string>,
 *   exec: (command: string, cwd: string, env: Record<string, string>) => { ok: boolean, output: string } }} o
 */
export function worktreeSetup(o) {
  /** @type {string | null} the commit setup last ran on, successfully */
  let installed = null;
  /** What ran: each run, and the times a commit under test reused the last one. */
  /** @type {{ runs: SetupRun[], reused: number }} */
  const record = { runs: [], reused: 0 };
  return {
    record,
    /**
     * Setup for `commit`, which the worktree has checked out.
     * @param {string} commit @param {'base' | 'batch'} kind
     * @returns {SetupOutcome}
     */
    ensure(commit, kind) {
      if (!o.commands.length) return { ok: true, ran: false };
      const files = installed === null ? [] : dependencyChanges(o.dir, installed, commit, o.names);
      if (installed !== null && !files.length) {
        if (installed !== commit) record.reused++;
        return { ok: true, ran: false };
      }
      installed = null;
      record.runs.push({ kind, commit, files });
      for (const command of o.commands) {
        const out = o.exec(command, o.dir, {});
        if (!out.ok) return { ok: false, command, output: out.output, files };
      }
      installed = commit;
      return { ok: true, ran: true };
    },
  };
}

/** How much of a failed install's output the message carries, from its end. */
const SETUP_TAIL = 800;

/**
 * What a branch is told when env.worktree_setup fails on it and it changes dependencies: the
 * install failed, not a check, so the branch is not mistaken for one with a failing build.
 * The tail of the install's output goes in the message, since the follow-up carries the message
 * and not the output.
 * @param {{ files: string[], command: string, where: string, output: string }} o where: the
 *   commit, as the branch's executor knows it ("your branch rebased onto main")
 */
export const dependencySetupMessage = (o) => {
  const out = o.output.trim();
  const tail = out.length > SETUP_TAIL ? `...${out.slice(-SETUP_TAIL)}` : out;
  return `Your branch changes dependencies (${o.files.join(', ')}), and the merge queue's worktree setup "${o.command}" (env.worktree_setup) failed on ${o.where}, so no check ran: this is not a failing build.${tail ? ` Its output ended: ${tail}` : ''} Make the install pass on your branch (the lockfile matches the manifests, and every package it names can be fetched), then run "${o.command}" in a fresh worktree of your branch to see the same.`;
};

// What hitld install proposes for a fresh worktree and the merge queue (HITLD-976): the lockfile's
// install as env.worktree_setup, and the check scripts the project's packages declare as
// merge.full_suite and merge.fast_checks. Read as data: nothing in the repository runs, and the
// owner approves each command before it goes into policy.json.

/** The package manager that runs the scripts of a JavaScript lockfile's packages. */
const RUNNERS = /** @type {Record<string, string>} */ ({
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
});

/** The package.json scripts read as checks. */
const CHECK_SCRIPTS = ['check', 'lint', 'typecheck', 'test'];
/** Folders a workspace glob never reaches into. */
const SKIP = new Set(['node_modules', '.git']);
/** How deep a workspace glob is followed. */
const DEPTH = 4;

/** @param {string} path @returns {Record<string, any> | null} */
function readJsonObject(path) {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * A YAML line without its comment: a "#" at the start or after a space, outside quotes, ends it.
 * @param {string} line
 */
function uncomment(line) {
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === '"' && c === '\\') i++;
    else if (quote && c === quote) quote = null;
    else if (!quote && (c === '"' || c === "'")) quote = c;
    else if (!quote && c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/**
 * A YAML scalar without its quotes; `plain` when it had none, so a leading & (anchor) or *
 * (alias) means YAML syntax rather than text.
 * @param {string} s @returns {{ value: string, plain: boolean }}
 */
function scalar(s) {
  const v = s.trim();
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return { value: v.slice(1, -1).replace(/''/g, "'"), plain: false };
  }
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    const value = v
      .slice(1, -1)
      .replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
    return { value, plain: false };
  }
  return { value: v, plain: true };
}

/** The items of a flow sequence's inside, split on the commas outside quotes. @param {string} s */
function flowItems(s) {
  /** @type {string[]} */
  const out = [];
  /** @type {string | null} */
  let quote = null;
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    const c = s[i];
    if (quote === '"' && c === '\\') i++;
    else if (quote && c === quote) quote = null;
    else if (!quote && (c === '"' || c === "'")) quote = c;
    else if (!quote && (c === ',' || i === s.length)) {
      if (s.slice(start, i).trim()) out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  return out;
}

/** The top-level `packages` key, bare or quoted, and what follows its colon. */
const PACKAGES_KEY = /^(?:packages|'packages'|"packages")\s*:(?:\s+(.*))?$/;
/** A YAML anchor at the start of a value: `&name`, then a space or the end. */
const ANCHOR = /^&[^\s,[\]{}]+(?:\s+|$)/;

/**
 * One packages entry as a glob, or null with a note when it is YAML this reader does not follow:
 * an anchor before the value is dropped and the value kept; an alias (`*name`) is refused.
 * @param {string} raw @param {string[]} notes
 */
function entry(raw, notes) {
  let text = raw.trim();
  const anchored = ANCHOR.exec(text);
  if (anchored) text = text.slice(anchored[0].length);
  const { value, plain } = scalar(text);
  if (plain && value.startsWith('*')) {
    notes.push(
      `the pnpm-workspace.yaml packages entry ${raw.trim()} is a YAML alias, which this reader does not follow, so it is left out; write the glob itself, quoted`,
    );
    return null;
  }
  return value || null;
}

/**
 * The `packages` list of a pnpm-workspace.yaml, or null when it has no such key. Read as a block
 * sequence (indented or not) or a flow sequence, with quotes and comments removed, an anchor on
 * the key or an entry allowed, and a leading byte-order mark or CRLF line ends allowed. An alias
 * is left out with a note in `notes`. Only that key is read, so no YAML library is needed.
 * @param {string} text @param {string[]} [notes] where what is not read is said
 * @returns {string[] | null}
 */
export function pnpmWorkspaceGlobs(text, notes = []) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(uncomment);
  const at = lines.findIndex((l) => PACKAGES_KEY.test(l.trimEnd()));
  if (at < 0) return null;
  let rest = (PACKAGES_KEY.exec(lines[at].trimEnd())?.[1] ?? '').trim();
  rest = rest.replace(ANCHOR, '');
  /** @param {string[]} raws */
  const globs = (raws) =>
    raws.map((r) => entry(r, notes)).filter((g) => /** @type {boolean} */ (g !== null));
  if (rest.startsWith('[')) {
    // A flow sequence, which may run over several lines until its closing bracket.
    let flow = rest.slice(1);
    for (let i = at + 1; !flowClosed(flow) && i < lines.length; i++) flow += ` ${lines[i].trim()}`;
    return /** @type {string[]} */ (globs(flowItems(flow.slice(0, flowEnd(flow)))));
  }
  if (rest) {
    notes.push(
      `the pnpm-workspace.yaml packages key holds ${rest}, not a list this reader follows (an alias or a single value), so no package is read from it`,
    );
    return [];
  }
  /** @type {string[]} */
  const raws = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim() || /^(---|\.\.\.)\s*$/.test(line)) continue;
    const item = /^\s*-(?:\s+(.*))?$/.exec(line.trimEnd());
    if (item) {
      if (item[1]?.trim()) raws.push(item[1]);
    } else if (/^\S/.test(line)) break; // the next top-level key
  }
  return /** @type {string[]} */ (globs(raws));
}

/** Where a flow sequence's closing bracket is, outside quotes, or -1. @param {string} s */
function flowEnd(s) {
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === '"' && c === '\\') i++;
    else if (quote && c === quote) quote = null;
    else if (!quote && (c === '"' || c === "'")) quote = c;
    else if (!quote && c === ']') return i;
  }
  return -1;
}

/** @param {string} s */
const flowClosed = (s) => flowEnd(s) >= 0;

/**
 * The workspace globs of a repository: pnpm-workspace.yaml's for pnpm, package.json `workspaces`
 * otherwise; `from` names where they were declared (null: not a workspace), and `note` says why
 * none were read when the file has no list.
 * @param {string} root @param {string} runner @param {Record<string, any> | null} rootPkg
 * @param {string[]} notes where what is not read is said
 * @returns {{ globs: string[], from: string | null, note: string | null }}
 */
function workspaceGlobs(root, runner, rootPkg, notes) {
  if (runner === 'pnpm') {
    const file = join(root, 'pnpm-workspace.yaml');
    if (!existsSync(file)) return { globs: [], from: null, note: null };
    const globs = pnpmWorkspaceGlobs(readFileSync(file, 'utf8'), notes);
    if (globs) return { globs, from: 'pnpm-workspace.yaml', note: null };
    // pnpm 10 reads a workspace file with no packages key as the root project alone (checked
    // with pnpm 10.28: `pnpm -r list` names only the root), so no package is read either. Other
    // versions were not checked.
    const pinned = /^pnpm@(\d+)/.exec(String(rootPkg?.packageManager ?? ''));
    const older =
      pinned && Number(pinned[1]) < 10
        ? `; package.json names ${String(rootPkg?.packageManager)}, an earlier pnpm, which may read the file differently: add a packages list to pnpm-workspace.yaml so every version reads the same packages`
        : '; add a packages list to pnpm-workspace.yaml to propose the packages’ checks';
    return {
      globs: [],
      from: 'pnpm-workspace.yaml',
      note: `pnpm-workspace.yaml has no packages key, which pnpm 10 reads as the root project alone, so no workspace package was found and only the root’s scripts are read${older}`,
    };
  }
  const w = rootPkg?.workspaces;
  const list = Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : null;
  if (!list) return { globs: [], from: null, note: null };
  return {
    globs: list.filter((/** @type {unknown} */ g) => typeof g === 'string'),
    from: 'package.json workspaces',
    note: null,
  };
}

/** A workspace glob without a leading "./" or a trailing "/". @param {string} g */
const trimGlob = (g) => g.replace(/^\.\//, '').replace(/\/+$/, '');

/** Folders the walk looks at before it stops, so a huge tree cannot stall the proposal. */
const MAX_FOLDERS = 20000;

/**
 * A glob's brace alternatives expanded (`{a,b}/*` is `a/*` and `b/*`, nested braces included),
 * or an error naming what the matcher cannot read: a range such as `{1..3}`, a brace with no
 * comma, an unclosed brace, a character class, an extglob, or more than MAX_ALTERNATIVES
 * alternatives (every folder is matched against each one, and the count doubles with each brace).
 * Never throws.
 * @param {string} glob @returns {{ globs: string[] } | { error: string }}
 */
export function expandBraces(glob) {
  if ((glob.match(/\{/g) ?? []).length > MAX_BRACES) {
    return { error: `more than ${MAX_BRACES} braces` };
  }
  return expandWithin(glob);
}

/** The most brace alternatives one glob may expand to. */
const MAX_ALTERNATIVES = 256;
/** The most braces one glob may hold, which bounds the expansion's recursion. */
const MAX_BRACES = 64;

/** @param {string} glob @returns {{ globs: string[] } | { error: string }} */
function expandWithin(glob) {
  if (/[[\]]|[@!+?*]\(/.test(glob)) return { error: 'a character class or an extglob' };
  const open = glob.indexOf('{');
  if (open < 0) {
    return glob.includes('}') ? { error: 'an unmatched brace' } : { globs: [glob] };
  }
  let depth = 0;
  let close = -1;
  /** @type {number[]} */
  const commas = [];
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++;
    else if (glob[i] === '}' && --depth === 0) {
      close = i;
      break;
    } else if (glob[i] === ',' && depth === 1) commas.push(i);
  }
  if (close < 0) return { error: 'an unclosed brace' };
  if (!commas.length) return { error: 'a brace with no comma, such as a range' };
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  const cuts = [open, ...commas, close];
  /** @type {string[]} */
  const out = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const r = expandWithin(head + glob.slice(cuts[k] + 1, cuts[k + 1]) + tail);
    if ('error' in r) return r;
    if (out.length + r.globs.length > MAX_ALTERNATIVES) {
      return { error: `more than ${MAX_ALTERNATIVES} brace alternatives` };
    }
    for (const g of r.globs) out.push(g);
  }
  return { globs: out };
}

/**
 * Whether a folder is matched by a workspace pattern as pnpm matches it: the pattern with
 * `/package.json` appended against the folder's package.json, so `dir/**` also holds `dir`.
 * @param {string} pattern @param {string} dir
 */
const holds = (pattern, dir) => globMatch(`${pattern}/package.json`, `${dir}/package.json`);

/**
 * The folders under `root` that hold a package.json and match the workspace globs ("!" globs
 * exclude), repository-relative and sorted. As pnpm does, folders whose names start with a dot
 * are skipped unless a pattern names a dot folder at that level. Brace globs are expanded; a glob the matcher cannot read is left out, and so is a
 * match deeper than DEPTH folder levels, each with a note in `notes`.
 * @param {string} root @param {string[]} globs @param {string[]} [notes]
 * @returns {{ packages: string[], usable: number }} usable: how many include globs were read
 */
export function workspacePackages(root, globs, notes = []) {
  /** @param {string[]} list */
  const expand = (list) =>
    list.flatMap((g) => {
      const r = expandBraces(g);
      if ('globs' in r) return r.globs.map(trimGlob);
      notes.push(
        `the workspace glob ${g} uses ${r.error}, which this reader does not expand, so it is left out; write it as plain globs`,
      );
      return [];
    });
  const include = expand(globs.filter((g) => !g.startsWith('!')));
  const exclude = expand(globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1)));
  if (!include.length) return { packages: [], usable: 0 };
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const deeper = [];
  let seen = 0;
  // A dot folder is walked only where an include pattern names one at that level, as `.tools/*`
  // does; `**` and `*` never reach into one (pnpm 10 agrees on both).
  /** @type {Map<number, string[]>} level to the dot segments the patterns name there */
  const dotSegments = new Map();
  for (const p of include) {
    p.split('/').forEach((seg, i) => {
      if (seg.startsWith('.') && seg !== '.') {
        dotSegments.set(i + 1, [...(dotSegments.get(i + 1) ?? []), seg]);
      }
    });
  }
  /** @param {string} name @param {number} depth */
  const dotNamed = (name, depth) =>
    (dotSegments.get(depth) ?? []).some((seg) => globMatch(seg, name));
  /** @param {string} rel @param {number} depth */
  const walk = (rel, depth) => {
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      if (e.name.startsWith('.') && !dotNamed(e.name, depth)) continue;
      if (++seen > MAX_FOLDERS) return;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (
        include.some((p) => holds(p, path)) &&
        !exclude.some((p) => holds(p, path)) &&
        existsSync(join(root, path, 'package.json'))
      ) {
        (depth > DEPTH ? deeper : out).push(path);
      }
      walk(path, depth + 1);
    }
  };
  walk('', 1);
  if (deeper.length) {
    deeper.sort();
    notes.push(
      `the workspace walk reads ${DEPTH} folder levels, so ${deeper.length} matching package${deeper.length > 1 ? 's' : ''} deeper ${deeper.length > 1 ? 'are' : 'is'} left out: ${deeper.slice(0, 5).join(', ')}${deeper.length > 5 ? ', …' : ''}`,
    );
  }
  if (seen > MAX_FOLDERS) {
    notes.push(
      `the workspace walk stopped after ${MAX_FOLDERS} folders, so packages past them may be missing`,
    );
  }
  return { packages: out.sort(), usable: include.length };
}

/** The test script npm init writes, which only fails. @param {unknown} s */
const placeholder = (s) => typeof s === 'string' && /no test specified/.test(s);

/**
 * The command that runs one script: at the root when the root declares it, else in every
 * workspace package that does (npm and pnpm; null for the others).
 * @param {string} runner @param {string} script @param {boolean} atRoot
 * @returns {string | null}
 */
function runScript(runner, script, atRoot) {
  if (atRoot) return runner === 'npm' && script === 'test' ? 'npm test' : `${runner} run ${script}`;
  if (runner === 'pnpm') return `pnpm -r --if-present run ${script}`;
  if (runner === 'npm') return `npm run ${script} --workspaces --if-present`;
  return null;
}

/**
 * @typedef {object} SetupProposal
 * @property {string} lockfile the lockfile it is read from
 * @property {string[]} worktree_setup for env.worktree_setup
 * @property {string[]} full_suite for merge.full_suite
 * @property {string[]} fast_checks for merge.fast_checks
 * @property {string[]} packages the workspace packages found, repository-relative
 * @property {string[]} sources where each check comes from, as `<file>: scripts.<name>`
 * @property {string[]} notes what the reading could not tell, or where a default stood in
 */

/** @param {Record<string, any> | null} pkg @returns {Record<string, unknown>} */
const scriptsOf = (pkg) =>
  pkg?.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts) ? pkg.scripts : {};

/**
 * What a fresh worktree and the merge queue need, read from the lockfile at `root` and the scripts
 * its packages declare, or null with no lockfile. A proposal for the owner, never applied.
 * @param {string | null} root @returns {SetupProposal | null}
 */
export function proposeSetup(root) {
  const lock = lockfileAt(root);
  if (!root || !lock) return null;
  /** @type {SetupProposal} */
  const out = {
    lockfile: lock.file,
    worktree_setup: [lock.install],
    full_suite: [],
    fast_checks: [],
    packages: [],
    sources: [],
    notes: [],
  };
  const runner = RUNNERS[lock.file];
  if (!runner) return out;
  const rootPkg = readJsonObject(join(root, 'package.json'));
  const ws = workspaceGlobs(root, runner, rootPkg, out.notes);
  const found = workspacePackages(root, ws.globs, out.notes);
  out.packages = found.packages;
  if (ws.note) out.notes.push(ws.note);
  // "No folder matches" only when some glob was read: a refused glob has its own note.
  const read = found.usable > 0 || !ws.globs.length;
  if (ws.from && !ws.note && read && !out.packages.length) {
    out.notes.push(
      `${ws.from} declares a workspace, but no folder with a package.json matches ${
        ws.globs.length ? ws.globs.join(', ') : 'its empty packages list'
      }, so only the root's scripts are read`,
    );
  }
  const rootScripts = scriptsOf(rootPkg);
  const members = out.packages.map((dir) => ({
    file: `${dir}/package.json`,
    scripts: scriptsOf(readJsonObject(join(root, dir, 'package.json'))),
  }));
  /** @type {Record<string, string>} */
  const command = {};
  for (const script of CHECK_SCRIPTS) {
    /** @param {Record<string, unknown>} s */
    const declares = (s) => typeof s[script] === 'string' && !placeholder(s[script]);
    if (declares(rootScripts)) {
      command[script] = /** @type {string} */ (runScript(runner, script, true));
      out.sources.push(`package.json: scripts.${script}`);
      continue;
    }
    const declaring = members.filter((m) => declares(m.scripts));
    const cmd = declaring.length ? runScript(runner, script, false) : null;
    if (!cmd) continue;
    command[script] = cmd;
    out.sources.push(...declaring.map((m) => `${m.file}: scripts.${script}`));
  }
  // The fast checks run on each branch first, the full suite once per batch: `check` (or else
  // `test`) is the suite, lint and type check are fast. With neither, the fast ones are the suite.
  const fast = ['lint', 'typecheck'].filter((s) => command[s]).map((s) => command[s]);
  const suite = command.check ?? command.test;
  out.full_suite = suite ? [suite] : fast;
  out.fast_checks = suite ? fast : [];
  return out;
}
