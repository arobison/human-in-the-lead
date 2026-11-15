// The versioning rule for the person and machine files (design part 16.5):
//
// - A reader accepts a schema_version at or below its own, and refuses a newer one with a message
//   that says to upgrade human-in-the-lead (the settings files belong to the person and the
//   machine, so every project on the machine reads them, each with the release it is pinned to).
// - A writer stamps the lowest version that expresses the file's content, so a file that uses
//   nothing new stays readable by the older release a project may still be pinned to.
// - `hitld config explain` warns when a project pinned on this machine cannot read the file.
//
// SETTINGS_VERSIONS is the one place that says what each version added and which release first
// reads it. A test checks that its last row is the schema's current version.

import { compareVersions, parseVersion } from '../release/semver.mjs';
import { NAME, VERSION } from '../version.mjs';
import { schemas } from '../schema/registry.mjs';

/**
 * @typedef {'person' | 'machine'} SettingsKind
 * @typedef {object} SettingsVersion
 * @property {number} version
 * @property {string} from the first release that reads it
 * @property {string[]} keys dotted paths; a file that sets any of them needs at least this version
 */

/**
 * What each version of each file added, oldest first. Version 1 added the keys the file had when
 * it first shipped. A later row names only what it added.
 * @type {Readonly<Record<SettingsKind, readonly SettingsVersion[]>>}
 */
export const SETTINGS_VERSIONS = Object.freeze({
  person: [
    { version: 1, from: '0.1.0-rc.1', keys: [] },
    { version: 2, from: '0.1.0-rc.1', keys: ['attention'] },
  ],
  machine: [{ version: 1, from: '0.1.0-rc.1', keys: [] }],
});

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} data @param {string} path */
function sets(data, path) {
  /** @type {unknown} */
  let at = data;
  for (const k of path.split('.')) {
    if (!isObject(at) || !Object.hasOwn(at, k)) return false;
    at = at[k];
  }
  return true;
}

/**
 * The lowest schema_version that expresses the content: the newest version whose keys the data
 * sets, and 1 when it sets none of them.
 * @param {SettingsKind} kind @param {unknown} data
 * @returns {number}
 */
export function lowestVersion(kind, data) {
  let lowest = 1;
  for (const v of SETTINGS_VERSIONS[kind]) {
    if (v.keys.some((k) => sets(data, k))) lowest = Math.max(lowest, v.version);
  }
  return lowest;
}

/**
 * The first release that reads a version of a file.
 * @param {SettingsKind} kind @param {number} version
 */
export function firstReleaseReading(kind, version) {
  const rows = SETTINGS_VERSIONS[kind];
  return (rows.find((v) => v.version >= version) ?? rows[rows.length - 1]).from;
}

/**
 * The first version in the table that a key forces, for a warning that names it.
 * @param {SettingsKind} kind @param {unknown} data
 * @returns {{ version: number, keys: string[], from: string }}
 */
export function versionNeeded(kind, data) {
  const version = lowestVersion(kind, data);
  const row = SETTINGS_VERSIONS[kind].find((v) => v.version === version);
  return {
    version,
    keys: (row?.keys ?? []).filter((k) => sets(data, k)),
    from: row?.from ?? SETTINGS_VERSIONS[kind][0].from,
  };
}

/**
 * The data with schema_version set to the lowest version that expresses it.
 * @template {Record<string, any>} T
 * @param {SettingsKind} kind @param {T} data
 * @returns {T}
 */
export function stampLowest(kind, data) {
  return { ...data, schema_version: lowestVersion(kind, data) };
}

/**
 * The highest version of a file that a release reads: the newest row whose first release is at or
 * before it. 0 for a release from before the file existed.
 * @param {SettingsKind} kind @param {string} release a version such as 0.1.0 or 0.1.0-rc.1
 */
export function readsUpTo(kind, release) {
  let reads = 0;
  for (const v of SETTINGS_VERSIONS[kind]) {
    if (compareVersions(release, v.from) >= 0) reads = v.version;
  }
  return reads;
}

/**
 * The refusal for a file written by a newer release than this one, or null. It names the project
 * and says what to do; nothing is read from the file.
 * @param {SettingsKind} kind @param {unknown} data
 * @param {{ known?: number, version?: string }} [options] known: the newest version this release
 *   reads (default: the schema's current version)
 * @returns {{ found: number, known: number, message: string } | null}
 */
export function newerRefusal(kind, data, options = {}) {
  const known = options.known ?? schemas().currentVersion(kind) ?? 1;
  const found = isObject(data) ? data.schema_version : undefined;
  if (!Number.isInteger(found) || /** @type {number} */ (found) <= known) return null;
  const release = options.version ?? VERSION;
  return {
    found: /** @type {number} */ (found),
    known,
    message: `schema_version is ${found}, newer than this release of ${NAME} (${release}) reads for the ${kind} file (${known}); upgrade ${NAME} (hitld) to read it. The file is left as it is`,
  };
}

/**
 * What a project's pinned release does with a settings file.
 * @typedef {object} Pin
 * @property {string} project the project's ID, or its directory name when no ID is known
 * @property {string | null} version the release it pins, or null when the pin names no release
 * @property {Partial<Record<SettingsKind, number>>} [reads] the newest version of each file it
 *   reads, when known from the pinned checkout itself
 * @property {string} where where the pin was found
 */

/**
 * Warnings for the projects pinned on this machine that cannot read a settings file as it is.
 * @param {SettingsKind} kind @param {unknown} data the file as it is on disk (null when absent)
 * @param {Pin[]} pins
 * @param {{ stamped?: unknown }} [options] stamped: the file's own schema_version
 * @returns {string[]}
 */
export function pinWarnings(kind, data, pins, options = {}) {
  if (!isObject(data)) return [];
  const needed = versionNeeded(kind, data);
  const stamped = Number.isInteger(options.stamped)
    ? /** @type {number} */ (options.stamped)
    : Number(data.schema_version ?? 1);
  const need = Math.max(needed.version, Number.isFinite(stamped) ? stamped : 1);
  /** @type {string[]} */
  const out = [];
  for (const pin of pins) {
    const reads =
      pin.reads?.[kind] ??
      (pin.version !== null && parseVersion(pin.version) ? readsUpTo(kind, pin.version) : null);
    const what =
      need === needed.version && needed.keys.length
        ? ` (it sets ${needed.keys.join(', ')})`
        : need > needed.version
          ? ' (its schema_version says so)'
          : '';
    if (reads === null) {
      if (need > 1) {
        out.push(
          `${pin.project} pins ${NAME} at ${pin.where}, which names no release, so hitld cannot tell whether it reads the ${kind} file at schema_version ${need}${what}; pin it to ${firstReleaseReading(kind, need)} or later`,
        );
      }
      continue;
    }
    if (reads === 0) {
      out.push(
        `${pin.project} pins ${NAME} ${pin.version ?? `(${pin.where})`}, a release from before the ${kind} file; update its pin to ${firstReleaseReading(kind, need)} or later`,
      );
    } else if (need > reads) {
      out.push(
        `${pin.project} pins ${NAME} ${pin.version ?? `(${pin.where})`}, which reads the ${kind} file up to schema_version ${reads}, and the file is at ${need}${what}; update ${pin.project}'s pin to ${firstReleaseReading(kind, need)} or later, or take those keys out of the file`,
      );
    }
  }
  return out;
}
