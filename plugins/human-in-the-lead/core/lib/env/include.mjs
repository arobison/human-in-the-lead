// Git-ignored files a worktree needs (HITLD-743). A project lists them in `.worktreeinclude` at the
// root of its primary checkout, in .gitignore syntax, as it does for Claude Code's own worktrees.
// The rules are Claude Code's:
//  - a file is copied only when it matches a pattern in the list AND git ignores it;
//  - a tracked file is never copied (the worktree's checkout already has its own copy);
//  - a path whose real location is outside the primary checkout is never copied, and nothing is
//    written through a link in the worktree;
//  - a file already in the worktree is left as it is.
//
// Only paths are ever reported or logged. Nothing here reads a copied file's contents into memory:
// a copy is a file-system copy, and no caller prints, logs or commits what a copied file holds.
// Each copy is checked to be git-ignored in the worktree as well, and removed if it is not, so a
// later `git add -A` (cleanup saves uncommitted work that way) cannot commit it.
//
// Templates (HITLD-744). A comment line `#hitld:template <path>.template` in `.worktreeinclude`
// marks a template in the primary checkout (tracked or git-ignored); setup renders it (template.mjs)
// with the worktree's leased port into `<path>`, the template's path without `.template`. Git and
// Claude Code read the line as a comment, so neither copies anything for it. A rendered file obeys
// the copy rules: never over a file the worktree has, never through a link, and removed when the
// worktree would not ignore it. `<path>` is never also copied as a plain file, so a listed pattern
// that matches it cannot bring in the primary checkout's own port. The template's text is read into
// memory to render it; neither it nor the rendered text is ever returned, printed or logged.

import { spawn } from 'node:child_process';
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { realPath } from './fsx.mjs';
import { renderTemplate } from './template.mjs';

export const INCLUDE_FILE = '.worktreeinclude';
export const TEMPLATE_SUFFIX = '.template';
/** `#hitld:template <path>`, spaces allowed after `#` and around the path. */
const TEMPLATE_MARK = /^#\s*hitld:template\s+(\S.*?)\s*$/;

/**
 * @typedef {'tracked' | 'not-ignored' | 'outside' | 'not-a-file' | 'exists' | 'unsafe-destination'
 *   | 'not-ignored-in-worktree' | 'error'} SkipReason
 * @typedef {{ path: string, reason: SkipReason }} Skipped
 * @typedef {object} IncludeList what `.worktreeinclude` names in the primary checkout
 * @property {boolean} listed whether the primary checkout has a `.worktreeinclude`
 * @property {string[]} files the files that may be copied: matched, git-ignored, untracked, and
 *   inside the primary checkout
 * @property {Skipped[]} skipped matched files that may not be copied, and why
 * @property {Template[]} templates the templates it marks, each with the path it renders to
 * @property {string} [note] why the list was not read, when it was not
 * @typedef {object} IncludeResult
 * @property {boolean} listed
 * @property {string[]} copied
 * @property {Skipped[]} skipped
 * @property {string} [note]
 *
 * @typedef {{ template: string, path: string }} Template a template and the path it renders to
 * @typedef {import('./template.mjs').RenderReason | 'bad-template-path' | 'template-missing'
 *   | 'outside' | 'not-a-file' | 'error'} TemplateFailReason
 * @typedef {{ template: string, path: string, reason: TemplateFailReason, detail: string }}
 *   TemplateFailure why a template was not rendered; never its text
 * @typedef {object} TemplateResult what setup did with the templates (paths only)
 * @property {string[]} rendered the paths written in the worktree
 * @property {TemplateFailure[]} failed
 * @property {Skipped[]} skipped rendered, but not written or not kept, under the copy rules
 * @property {number} [port] the leased port the templates were rendered with
 * @property {string} [note]
 */

/**
 * Run git with NUL-separated paths on standard input and return the NUL-separated paths it
 * prints. With input (check-ignore), exit code 1 means "none", so it is not an error there.
 * @param {string[]} args @param {string} cwd @param {string[]} [input]
 * @returns {Promise<string[]>}
 */
function gitPaths(args, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */
    const out = [];
    let errOut = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => (errOut += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || (input && code === 1)) {
        resolve(Buffer.concat(out).toString('utf8').split('\0').filter(Boolean));
      } else {
        const detail = errOut.trim().split('\n').slice(-3).join(' ');
        reject(new Error(`git ${args.slice(0, 2).join(' ')} failed: ${detail}`));
      }
    });
    // A git that never reads its input (ls-files) may exit before it is written: that EPIPE is
    // not an error, the exit code says what happened.
    child.stdin.on('error', () => {});
    child.stdin.end(input?.length ? `${input.join('\0')}\0` : '');
  });
}

/** @param {string} root a real path @param {string} real a real path */
function isInside(root, real) {
  const back = relative(root, real);
  return back !== '' && back !== '..' && !back.startsWith(`..${sep}`) && !isAbsolute(back);
}

/**
 * The paths among `paths` that git ignores in `root`. Tracked paths are never reported.
 * @param {string} root @param {string[]} paths
 */
const ignoredIn = async (root, paths) =>
  new Set(paths.length ? await gitPaths(['check-ignore', '-z', '--stdin'], root, paths) : []);

/**
 * What `.worktreeinclude` in the primary checkout names, sorted by path.
 * @param {string} primary the primary checkout's root
 * @returns {Promise<IncludeList>}
 */
export async function listIncluded(primary) {
  const root = realPath(primary);
  const list = join(root, INCLUDE_FILE);
  let st;
  try {
    st = lstatSync(list);
  } catch {
    return { listed: false, files: [], skipped: [], templates: [] };
  }
  if (!st.isFile()) {
    return {
      listed: false,
      files: [],
      skipped: [],
      templates: [],
      note: `${INCLUDE_FILE} is not a plain file, so it is not read`,
    };
  }
  const templates = templateMarks(readFileSync(list, 'utf8'));
  const rendered = new Set(templates.map((t) => t.path));
  const exclude = `--exclude-from=${list}`;
  const [untracked, tracked] = await Promise.all([
    gitPaths(['ls-files', '-z', '--others', '--ignored', exclude], root),
    gitPaths(['ls-files', '-z', '--cached', '--ignored', exclude], root),
  ]);
  const ignored = await ignoredIn(root, untracked);
  /** @type {string[]} */
  const files = [];
  /** @type {Skipped[]} */
  const skipped = [...new Set(tracked)].map((path) => ({ path, reason: 'tracked' }));
  for (const path of untracked) {
    if (rendered.has(path)) continue; // a template renders it: never the primary's own copy
    if (!ignored.has(path)) {
      skipped.push({ path, reason: 'not-ignored' });
      continue;
    }
    let real;
    try {
      real = realPath(join(root, path));
    } catch {
      skipped.push({ path, reason: 'outside' }); // a dangling link: nowhere safe to read
      continue;
    }
    if (!isInside(root, real)) skipped.push({ path, reason: 'outside' });
    else if (!statSync(real).isFile()) skipped.push({ path, reason: 'not-a-file' });
    else files.push(path);
  }
  files.sort();
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { listed: true, files, skipped, templates };
}

/**
 * The templates the marks in `.worktreeinclude` name, in the order listed, once each. A mark whose
 * path is not a plain relative path ending in `.template` is kept, with an empty `path`, so it is
 * reported as `bad-template-path` rather than lost.
 * @param {string} text the list's contents
 * @returns {Template[]}
 */
function templateMarks(text) {
  /** @type {Map<string, Template>} */
  const found = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = TEMPLATE_MARK.exec(line.trim());
    if (!m) continue;
    const template = m[1].replace(/^\//, '');
    const clean = posix.normalize(template);
    const ok =
      clean === template &&
      !template.includes('\\') &&
      !/^[A-Za-z]:/.test(template) &&
      !template.split('/').includes('..') &&
      template.endsWith(TEMPLATE_SUFFIX) &&
      !template.endsWith(`/${TEMPLATE_SUFFIX}`) &&
      template !== TEMPLATE_SUFFIX;
    if (!found.has(template)) {
      found.set(template, { template, path: ok ? template.slice(0, -TEMPLATE_SUFFIX.length) : '' });
    }
  }
  return [...found.values()];
}

/**
 * Read and render one template from the primary checkout, in memory.
 * @param {string} primary the primary checkout's real path @param {Template} t
 * @param {Record<string, string>} values
 * @returns {{ ok: true, text: string, mode: number } | { ok: false, failure: TemplateFailure }}
 */
function renderOne(primary, t, values) {
  /** @param {TemplateFailReason} reason @param {string} detail */
  const broken = (reason, detail) => ({
    ok: /** @type {const} */ (false),
    failure: { template: t.template, path: t.path, reason, detail },
  });
  if (!t.path) {
    return broken(
      'bad-template-path',
      `a template is a relative path inside the repository ending in ${TEMPLATE_SUFFIX}`,
    );
  }
  let real;
  try {
    real = realPath(join(primary, t.template));
  } catch {
    return broken('template-missing', 'the primary checkout has no such file');
  }
  if (!isInside(primary, real))
    return broken('outside', 'the template resolves outside the repository');
  let st;
  try {
    st = statSync(real);
  } catch {
    return broken('template-missing', 'the primary checkout has no such file');
  }
  if (!st.isFile()) return broken('not-a-file', 'the template is not a plain file');
  let text;
  try {
    text = readFileSync(real, 'utf8');
  } catch {
    return broken('error', 'the template could not be read');
  }
  const out = renderTemplate(text, values);
  if (!out.ok) return broken(out.reason, out.detail);
  return { ok: true, text: out.text, mode: st.mode & 0o777 };
}

/**
 * Whether the directory for `rel` can be made in the worktree without passing through a link: each
 * existing part must be a real directory where it is expected.
 * @param {string} wtRoot the worktree's real path @param {string} rel
 */
function safeParent(wtRoot, rel) {
  let here = wtRoot;
  // Part by part, never `mkdir -p`, which would follow a link and create directories past it.
  for (const part of dirname(rel)
    .split('/')
    .filter((p) => p && p !== '.')) {
    here = join(here, part);
    let st;
    try {
      st = lstatSync(here);
    } catch {
      mkdirSync(here);
      continue;
    }
    if (!st.isDirectory()) return false; // a link (or a file) where a directory should be
  }
  return realPath(here) === here;
}

/**
 * Copy into a worktree each file the primary checkout's `.worktreeinclude` names, under the rules
 * at the top of this file. Never overwrites a file the worktree has.
 * @param {{ primary: string, worktree: string }} r
 * @returns {Promise<IncludeResult>}
 */
export async function copyIncluded(r) {
  const primary = realPath(r.primary);
  const wtRoot = realPath(r.worktree);
  if (primary === wtRoot) return { listed: false, copied: [], skipped: [] };
  const found = await listIncluded(primary);
  /** @type {Skipped[]} */
  const skipped = [...found.skipped];
  /** @type {string[]} */
  const copied = [];
  for (const path of found.files) {
    const dest = join(wtRoot, path);
    try {
      lstatSync(dest);
      skipped.push({ path, reason: 'exists' });
      continue;
    } catch {
      // not there: copy it
    }
    try {
      if (!safeParent(wtRoot, path)) {
        skipped.push({ path, reason: 'unsafe-destination' });
        continue;
      }
      // COPYFILE_EXCL: never through a link or over a file that appeared since the check above.
      copyFileSync(realPath(join(primary, path)), dest, constants.COPYFILE_EXCL);
      copied.push(path);
    } catch {
      skipped.push({ path, reason: 'error' });
    }
  }
  // A copy must stay git-ignored in the worktree, whose ignore rules can differ from the primary
  // checkout's working copy; one that is not is removed.
  const ignored = await ignoredIn(wtRoot, copied);
  for (const path of copied.filter((p) => !ignored.has(p))) {
    unlinkSync(join(wtRoot, path));
    skipped.push({ path, reason: 'not-ignored-in-worktree' });
  }
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return {
    listed: found.listed,
    copied: copied.filter((p) => ignored.has(p)),
    skipped,
    ...(found.note ? { note: found.note } : {}),
  };
}

/**
 * The files `.worktreeinclude` names that a worktree does not have. Paths only.
 * @param {{ primary: string, worktree: string }} r
 * @returns {Promise<{ listed: boolean, files: string[], missing: string[], note?: string }>}
 */
export async function missingIncluded(r) {
  const found = await listIncluded(r.primary);
  const wtRoot = realPath(r.worktree);
  const missing = found.files.filter((path) => {
    try {
      lstatSync(join(wtRoot, path));
      return false;
    } catch {
      return true;
    }
  });
  return {
    listed: found.listed,
    files: found.files,
    missing,
    ...(found.note ? { note: found.note } : {}),
  };
}

/**
 * The values a template's placeholders take in a worktree.
 * @param {number | undefined} port the holder's leased port, if it has one
 * @returns {Record<string, string>}
 */
export const templateValues = (port) => (port === undefined ? {} : { HITLD_PORT: String(port) });

/**
 * Render into a worktree each template the primary checkout's `.worktreeinclude` marks, under the
 * copy rules at the top of this file. Never overwrites a file the worktree has. Paths only come back.
 * @param {{ primary: string, worktree: string, values: Record<string, string> }} r
 * @returns {Promise<TemplateResult>}
 */
export async function renderIncluded(r) {
  const primary = realPath(r.primary);
  const wtRoot = realPath(r.worktree);
  /** @type {TemplateResult} */
  const result = { rendered: [], failed: [], skipped: [] };
  if (primary === wtRoot) return result;
  const { templates } = await listIncluded(primary);
  /** @type {string[]} */
  const written = [];
  for (const t of templates) {
    const out = renderOne(primary, t, r.values);
    if (!out.ok) {
      result.failed.push(out.failure);
      continue;
    }
    const dest = join(wtRoot, t.path);
    try {
      lstatSync(dest);
      result.skipped.push({ path: t.path, reason: 'exists' });
      continue;
    } catch {
      // not there: write it
    }
    try {
      if (!safeParent(wtRoot, t.path)) {
        result.skipped.push({ path: t.path, reason: 'unsafe-destination' });
        continue;
      }
      // flag wx: never through a link or over a file that appeared since the check above.
      writeFileSync(dest, out.text, { flag: 'wx', mode: out.mode });
      written.push(t.path);
    } catch {
      result.skipped.push({ path: t.path, reason: 'error' });
    }
  }
  const ignored = await ignoredIn(wtRoot, written);
  for (const path of written) {
    if (ignored.has(path)) {
      result.rendered.push(path);
    } else {
      unlinkSync(join(wtRoot, path));
      result.skipped.push({ path, reason: 'not-ignored-in-worktree' });
    }
  }
  return result;
}

/**
 * Whether each template `.worktreeinclude` marks renders now (in memory, nothing written) and
 * whether the worktree has the file it renders to. Paths and reasons only.
 * @param {{ primary: string, worktree: string, values: Record<string, string> }} r
 * @returns {Promise<{ templates: Template[], failed: TemplateFailure[], missing: string[] }>}
 */
export async function checkTemplates(r) {
  const primary = realPath(r.primary);
  const wtRoot = realPath(r.worktree);
  const { templates } = await listIncluded(primary);
  /** @type {TemplateFailure[]} */
  const failed = [];
  /** @type {string[]} */
  const missing = [];
  if (primary === wtRoot) return { templates, failed, missing }; // the owner's own files
  for (const t of templates) {
    const out = renderOne(primary, t, r.values);
    if (!out.ok) {
      failed.push(out.failure);
      continue;
    }
    try {
      lstatSync(join(wtRoot, t.path));
    } catch {
      missing.push(t.path);
    }
  }
  return { templates, failed, missing };
}
