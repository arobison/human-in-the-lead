// What this machine's last pull of the private store did (HITLD-148): reached the remote and merged
// it, or could not. The settings that travel in the store (settings/store-copy.mjs) are read only
// after a pull that reached the remote, so a session never runs on a copy it could not bring up to
// date (HITLD-163).
//
// Machine-local, like the record of what was merged (push-pull.mjs): it lives inside the store's
// .git directory, which is never committed, never bundled and refused if a bundle carries it.
//   <store>/.git/hitld-pull.json   { schema_version, at, status, url?, code?, message? }
//
// A push that went through records `done` too: it merged the remote's head first. A record is
// tied to the remote's address, and is too old to count after MAX_AGE_HOURS (settings/store-copy.mjs).
//
// Light on purpose: settings loading reads it on every command, before any push or pull code is
// loaded.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { replaceFile } from './host.mjs';
import { ensureRepo } from './git.mjs';

const FILE = 'hitld-pull.json';

/** How long a pull that reached the remote counts: the settings in the store are read for this long. */
export const MAX_AGE_HOURS = 24;

/**
 * @typedef {object} LastPull
 * @property {string} at when the pull ran (ISO 8601)
 * @property {'done' | 'unreachable' | 'failed'} status done: the remote was reached and merged (or
 *   was empty, or already merged); unreachable: it could not be reached; failed: it answered and
 *   what it holds could not be used
 * @property {string} [url] the remote's address the pull was made against (absent when the pull
 *   failed before an address was opened)
 * @property {string} [code] for unreachable and failed: the error's code
 * @property {string} [message] for unreachable and failed: what went wrong
 */

/** @param {string} root */
const pathOf = (root) => join(resolve(root), '.git', FILE);

/**
 * Record what a pull did. Never throws: a record that cannot be written leaves the last one, and
 * a missing record reads as "not pulled here", which is the cautious answer.
 * @param {string} root the store
 * @param {Omit<LastPull, 'at'>} outcome @param {() => Date} [now]
 */
export function recordPull(root, outcome, now = () => new Date()) {
  try {
    ensureRepo(root);
    const path = pathOf(root);
    const tmp = `${path}.${process.pid}.tmp`;
    const record = { schema_version: 1, at: now().toISOString(), ...outcome };
    writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    replaceFile(tmp, path);
  } catch {
    // Not recorded: the settings reader treats the store as not pulled here.
  }
}

/**
 * The last pull's record, or null when this store was never pulled here or the record is damaged.
 * @param {string} root @returns {LastPull | null}
 */
export function readLastPull(root) {
  const path = pathOf(root);
  if (!existsSync(path)) return null;
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    if (
      v?.schema_version === 1 &&
      typeof v.at === 'string' &&
      ['done', 'unreachable', 'failed'].includes(v.status)
    ) {
      return {
        at: v.at,
        status: v.status,
        ...(typeof v.url === 'string' ? { url: v.url } : {}),
        ...(typeof v.code === 'string' ? { code: v.code } : {}),
        ...(typeof v.message === 'string' ? { message: v.message } : {}),
      };
    }
  } catch {
    // Damaged: read as never pulled.
  }
  return null;
}
