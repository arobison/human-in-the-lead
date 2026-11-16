// A throwaway consumer repository for the orchestrator's tests: a tracker with items carrying
// touches, a tiny source file with a test, a policy with a full suite, and a private store outside
// the repository.

import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { buildConsumer, writeSetupDone } from '../lib/eval/orchestrator-fixtures.mjs';
import { tempDir } from './helpers/tmp.mjs';

/** @param {string} cwd @param {...string} args */
export const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** @param {string} root @param {Record<string, string>} files */
export function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

export { itemFile as item } from '../lib/eval/orchestrator-fixtures.mjs';

/**
 * The repository, on main, committed, with a private store outside it.
 * @param {{ policy?: Record<string, unknown>, files?: Record<string, string>, setup?: boolean }} [options]
 *   setup: false leaves the person and machine files unwritten (first run not done)
 */
export function makeConsumer(options = {}) {
  const base = realpathSync(tempDir('hitld-orch-'));
  const root = buildConsumer(join(base, 'repo'), options);
  const data = join(base, 'data');
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    XDG_DATA_HOME: data,
    XDG_CONFIG_HOME: join(base, 'config'),
    HITLD_SESSION: 'test-session',
    PATH: process.env.PATH,
  };
  if (options.setup !== false) writeSetupDone(env);
  /**
   * Run a hitld command in the repository.
   * @param {string[]} argv @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [o]
   */
  const hitld = async (argv, o = {}) => {
    let out = '';
    const exit = await main(argv, {
      out: (t) => (out += t),
      err: () => {},
      cwd: o.cwd ?? root,
      env: { ...env, ...(o.env ?? {}) },
    });
    /** @type {Record<string, any>} */
    let result;
    try {
      result = JSON.parse(out);
    } catch {
      result = { text: out };
    }
    return { exit, result };
  };
  return { root, base, data, env, hitld };
}

/** Status-line input with plenty of headroom. */
export const STATUS_INPUT = (/** @type {string} */ dir) =>
  JSON.stringify({
    session_id: 's-1',
    workspace: { project_dir: dir },
    rate_limits: {
      five_hour: { used_percentage: 10, resets_at: Math.floor(Date.now() / 1000) + 3600 },
      seven_day: { used_percentage: 20, resets_at: Math.floor(Date.now() / 1000) + 86400 },
    },
  });

/**
 * A report in the fixed shape.
 * @param {{ item: string, sha: string, branch: string, result?: string, questions?: string }} r
 */
export const report = (r) =>
  [
    `item: ${r.item}`,
    `result: ${r.result ?? 'done'}`,
    `commit: ${r.sha} (branch ${r.branch})`,
    'evidence:',
    '  - node --test test/: 1 passed',
    'bench_runs: none',
    'deviations: none',
    'calls: none',
    `questions: ${r.questions ?? 'none'}`,
    '',
  ].join('\n');
