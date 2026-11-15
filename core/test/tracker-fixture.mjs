// A throwaway git repository with a tracker in it, for the files backend's tests.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolvePolicy } from '../lib/policy/policy.mjs';

/** @param {string} cwd @param {...string} args */
export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * A resolved policy with key W, and optionally reserved ID blocks.
 * @param {{ name: string, from: number, to?: number }[]} [blocks]
 * @param {Record<string, unknown>} [project]
 */
export function policyFor(blocks = [], project = {}) {
  const { policy, errors } = resolvePolicy({
    schema_version: 1,
    project: { id: 'fixture', key: 'W', ...project },
    ids: { blocks },
  });
  if (!policy) throw new Error(JSON.stringify(errors));
  return policy;
}

/** @param {Record<string, string | string[]>} fields @param {string} [body] */
export function itemText(fields, body = '\nBody.\n') {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    lines.push(Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`);
  }
  return `${lines.join('\n')}\n---\n${body}`;
}

/**
 * A repository on branch `main` whose work directory is `work/`, holding a small tracker:
 * a long-outcome milestone W-1 (no parent), a project W-2, a Done item W-3, a ready item W-4 (needs W-3), a blocked item
 * W-5 (needs W-4) and an open decision W-6 that W-5 also needs.
 * @param {{ files?: Record<string, string>, commit?: boolean, omit?: string[] }} [options] extra
 *   files, by repository-relative path; omit leaves out fixture files, by path
 */
export function makeRepo({ files = {}, commit = true, omit = [] } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hitld-tracker-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  /** @type {Record<string, string>} */
  const base = {
    'work/milestones/W-1-goal.md': itemText({
      id: 'W-1',
      title: 'The goal',
      kind: 'milestone',
      state: 'planned',
      owner: 'owner',
    }),
    'work/projects/W-2-the-project.md': itemText({
      id: 'W-2',
      title: 'The project',
      kind: 'project',
      state: 'planned',
      owner: 'owner',
    }),
    'work/items/W-3-first-step.md': itemText({
      id: 'W-3',
      title: 'First step',
      kind: 'work',
      state: 'done',
      project: 'W-2',
    }),
    'work/items/W-4-second-step.md': itemText({
      id: 'W-4',
      title: 'Second step',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      needs: ['W-3'],
    }),
    'work/items/W-5-third-step.md': itemText({
      id: 'W-5',
      title: 'Third step',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      needs: ['W-4', 'W-6'],
    }),
    'work/items/W-6-which-way.md': itemText({
      id: 'W-6',
      title: 'Which way?',
      kind: 'decision',
      state: 'planned',
      project: 'W-2',
      decider: 'owner',
    }),
  };
  for (const path of omit) delete base[path];
  put(root, { ...base, ...files });
  if (commit) commitAll(root, 'fixture');
  return root;
}

/** Write files (repository-relative paths) without committing. @param {string} root @param {Record<string, string>} files */
export function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

/** @param {string} root @param {string} message */
export function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD').trim();
}
