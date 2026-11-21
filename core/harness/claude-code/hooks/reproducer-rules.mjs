// The reproducer agent's rules, applied by the plugin's PreToolUse guard (guard.mjs) to every
// tool call of that agent type (HITLD-30, design parts 2.2 and 10.2): it reads untrusted text and
// writes code, so it gets the narrowest reach the work allows.
//
//   Bash              only `hitld reproduce run <sandbox> --test <path>`, as one plain command
//                     whose arguments hold only letters, digits and . _ / -
//   Write, Edit       only a test file (*.test.js, *.test.mjs, *.test.cjs) under
//                     <sandbox>/work/test/ or <sandbox>/work/tests/
//   Read, Glob, Grep  only inside a sandbox directory
//   anything else     refused (the agent definition lists only these six tools as well)
//
// A sandbox directory is one that holds the marker hitld reproduce open writes. Every other caller
// passes through untouched. This reads paths and command text; `hitld reproduce check` is the
// second line: it refuses any change but one new test file, and runs that test itself.

import { existsSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const MARKER = '.hitld-reproduce-sandbox';

/** @param {Record<string, any>} input */
export const isReproducer = (input) => input.agent_type === 'human-in-the-lead:reproducer';

/** The sandbox directory a resolved path is in, or null. @param {string} path */
function sandboxOf(path) {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, MARKER))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** @param {unknown} p @param {string} cwd */
const absolute = (p, cwd) => (typeof p === 'string' && p ? resolve(cwd, p) : null);

/** Whether any part of the path below the sandbox is a link. @param {string} path @param {string} box */
function linkBelow(path, box) {
  for (let p = path; p !== box && p.startsWith(box + sep); p = dirname(p)) {
    try {
      if (lstatSync(p).isSymbolicLink()) return true;
    } catch {
      // Not there yet: a file the tool will create.
    }
  }
  return false;
}

const SAFE = '[A-Za-z0-9._/-]+';
const RUN = new RegExp(`^hitld reproduce run (${SAFE}) --test (${SAFE})$`);
/** A test file name the reproducer may write. */
const TEST_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.test\.(js|mjs|cjs)$/;

/**
 * Why the reproducer may not make this tool call, or null when it may.
 * @param {Record<string, any>} input the hook input
 * @returns {string | null}
 */
export function reproducerRefusal(input) {
  const tool = String(input.tool_name ?? '');
  const args = input.tool_input ?? {};
  const cwd = typeof input.cwd === 'string' && isAbsolute(input.cwd) ? input.cwd : process.cwd();
  if (tool === 'Bash') {
    const command = String(args.command ?? '');
    const m = RUN.exec(command);
    if (!m) {
      return 'the reproducer runs only `hitld reproduce run <sandbox> --test <path>`, as one plain command';
    }
    const box = absolute(m[1], cwd);
    return box && sandboxOf(box) === box ? null : `${m[1]} is not a reproducer sandbox`;
  }
  if (tool === 'Write' || tool === 'Edit') {
    const path = absolute(args.file_path, cwd);
    const box = path && sandboxOf(dirname(path));
    if (!path || !box) return 'the reproducer writes only inside its sandbox';
    const rel = path.slice(box.length + 1).split(sep);
    if (
      rel[0] !== 'work' ||
      !['test', 'tests'].includes(rel[1]) ||
      rel.length < 3 ||
      !TEST_NAME.test(rel[rel.length - 1])
    ) {
      return 'the reproducer writes only its test file (*.test.js, *.test.mjs or *.test.cjs), under work/test/ or work/tests/ in its sandbox';
    }
    return linkBelow(path, box) ? 'the reproducer does not write through a link' : null;
  }
  if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') {
    const path = absolute(args.file_path ?? args.path ?? cwd, cwd);
    const box = path && sandboxOf(path);
    if (!path || !box) return 'the reproducer reads only inside its sandbox';
    const pattern = String(args.pattern ?? '');
    if (tool === 'Glob' && (isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..'))) {
      return 'the reproducer globs only inside its sandbox';
    }
    return linkBelow(path, box) ? 'the reproducer does not read through a link' : null;
  }
  return `the reproducer does not use ${tool || 'that tool'}`;
}
