// The projects pinned on this machine and the release each one runs (design part 16.5), for the
// check that the person and machine files can be read by all of them. Two sources:
//
// - The project in the current directory: the marketplace pin in `.claude/settings.json` (a tag
//   from `hitld install --ref`, or a checkout directory in development; the checkout's own
//   schemas then say exactly what it reads).
// - Every other project with a private store on this machine: the release its last run started
//   with (the ledger's `run-started` event).
//
// Reads only. Nothing here is trusted beyond being shown in a warning.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { findRepoRoot } from '../policy/policy.mjs';
import { TAG } from '../release/semver.mjs';
import { LEDGER_KEY } from '../ledger/ledger.mjs';
import { MARKETPLACE } from '../install/install.mjs';
import { machineDir } from './files.mjs';

/** @typedef {import('./versions.mjs').Pin} Pin */

/** @param {string} path @returns {any} */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * What a pinned checkout reads, from its own schemas.
 * @param {string} dir
 * @returns {{ version: string | null, reads: Partial<Record<'person' | 'machine', number>> }}
 */
function checkoutReads(dir) {
  const pkg = readJson(join(dir, 'package.json'));
  /** @type {Partial<Record<'person' | 'machine', number>>} */
  const reads = {};
  for (const kind of /** @type {const} */ (['person', 'machine'])) {
    const v = readJson(join(dir, 'schemas', `${kind}.schema.json`))?.['x-hitld-schema-version'];
    if (Number.isInteger(v)) reads[kind] = v;
  }
  return { version: typeof pkg?.version === 'string' ? pkg.version : null, reads };
}

/**
 * The pin the project at `root` declares in .claude/settings.json, or null when it has none.
 * @param {string} root @param {string} project
 * @returns {Pin | null}
 */
export function declaredPin(root, project) {
  const source = readJson(join(root, '.claude', 'settings.json'))?.extraKnownMarketplaces?.[
    MARKETPLACE
  ]?.source;
  if (!source || typeof source !== 'object') return null;
  if (source.source === 'directory' && typeof source.path === 'string') {
    const found = existsSync(source.path) ? checkoutReads(source.path) : null;
    return {
      project,
      version: found?.version ?? null,
      ...(found ? { reads: found.reads } : {}),
      where: `a checkout at ${source.path}`,
    };
  }
  if (typeof source.ref === 'string') {
    const tag = TAG.exec(source.ref);
    return {
      project,
      version: tag ? source.ref.slice(1) : null,
      where: `ref ${source.ref}`,
    };
  }
  return null;
}

/**
 * The release a project's last run started with, from its private store's ledger.
 * @param {string} storeDir @returns {string | null}
 */
function lastRunVersion(storeDir) {
  let text;
  try {
    text = readFileSync(join(storeDir, LEDGER_KEY), 'utf8');
  } catch {
    return null;
  }
  /** @type {string | null} */
  let version = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"run-started"')) continue;
    try {
      const e = JSON.parse(line);
      const v = e?.skill_versions?.hitld_version ?? e?.skill_versions?.plugin;
      if (e?.event === 'run-started' && typeof v === 'string') version = v;
    } catch {
      // a damaged line says nothing
    }
  }
  return version;
}

/**
 * The projects pinned on this machine.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, home?: string, project?: string | null }} [options]
 *   project: the current project's ID, so its own store is not read as another project
 * @returns {Pin[]}
 */
export function pinnedProjects(options = {}) {
  /** @type {Pin[]} */
  const pins = [];
  const root = options.cwd ? findRepoRoot(options.cwd) : null;
  const own = options.project ?? (root ? basename(root) : null);
  if (root && own) {
    const pin = declaredPin(root, own);
    if (pin) pins.push(pin);
  }
  const stores = dirname(machineDir({ env: options.env, home: options.home }));
  /** @type {import('node:fs').Dirent[]} */
  let entries = [];
  try {
    entries = readdirSync(stores, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const d of entries) {
    if (!d.isDirectory() || d.name.startsWith('_') || d.name === own) continue;
    const version = lastRunVersion(join(stores, d.name));
    if (version !== null) {
      pins.push({ project: d.name, version, where: 'its last run' });
    }
  }
  return pins;
}
