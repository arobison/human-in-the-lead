// Semantic versions for releases (design part 16.5): MAJOR.MINOR.PATCH with an optional
// pre-release part after a hyphen (0.1.0-rc.1). Build metadata (+...) is not used.

/** A semantic version, with an optional pre-release part. */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
/** A release tag from before release packages: v and a semantic version. */
export const TAG =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
/** A pre-release label: lower-case letters, such as rc, beta or alpha. */
export const PRE_LABEL = /^[a-z]+$/;

/**
 * @typedef {{ major: number, minor: number, patch: number, pre: string | null }} Version
 * @typedef {'major' | 'minor' | 'patch'} Bump
 */

/** @param {string} v @returns {Version | null} */
export function parseVersion(v) {
  const m = SEMVER.exec(String(v));
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null } : null;
}

/**
 * The pre-release label `release propose --pre` takes for a version: rc for 0.1.0-rc.2. Null for
 * a full release (or a string that is not a version); undefined for a pre-release part propose
 * never gives (not <label>.<n>).
 * @param {string} version @returns {string | null | undefined}
 */
export function preLabelOf(version) {
  const pre = parseVersion(version)?.pre;
  if (pre == null) return null;
  return /^([a-z]+)\.[1-9]\d*$/.exec(pre)?.[1];
}

/** Whether a version is a pre-release. @param {string} version */
export const isPrerelease = (version) => parseVersion(version)?.pre != null;

/** The version without its pre-release part. @param {string} version */
export const coreOf = (version) => String(version).replace(/-.*$/, '');

/**
 * Compare two versions: negative when a comes first. A pre-release comes before its release;
 * pre-release identifiers compare numerically when both are numbers (semver 2.0.0, rule 11).
 * @param {string} a @param {string} b
 */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  for (let i = 1; i <= 3; i++) if (pa[i] !== pb[i]) return Number(pa[i]) - Number(pb[i]);
  if (pa[4] === pb[4]) return 0;
  if (pa[4] === undefined) return 1;
  if (pb[4] === undefined) return -1;
  const xa = pa[4].split('.');
  const xb = pb[4].split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    if (xa[i] === xb[i]) continue;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb) return Number(xa[i]) - Number(xb[i]);
    if (na !== nb) return na ? -1 : 1;
    return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Apply a bump to a full release's version.
 * @param {string} version @param {Bump} bump
 */
export function bumpVersion(version, bump) {
  const v = parseVersion(coreOf(version));
  if (!v) throw new Error(`"${version}" is not a semantic version`);
  if (bump === 'major') return `${v.major + 1}.0.0`;
  if (bump === 'minor') return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

/**
 * The bump a version is from a base: the part that rose. Null when it does not rise.
 * @param {string} base @param {string} version
 * @returns {Bump | null}
 */
export function bumpBetween(base, version) {
  const a = parseVersion(coreOf(base));
  const b = parseVersion(coreOf(version));
  if (!a || !b) return null;
  if (b.major > a.major) return 'major';
  if (b.major === a.major && b.minor > a.minor) return 'minor';
  if (b.major === a.major && b.minor === a.minor && b.patch > a.patch) return 'patch';
  return null;
}

const RANK = { patch: 0, minor: 1, major: 2 };
/** Whether bump a is at least bump b. @param {Bump} a @param {Bump} b */
export const atLeast = (a, b) => RANK[a] >= RANK[b];

/**
 * The next pre-release of a version under a label (a channel): `<version>-<label>.<n>`, one above
 * the highest number already released for that version and label. Each channel keeps its own
 * counter: rc.3 and beta.1 of one version do not share a number.
 * @param {string} version a full version @param {string} label
 * @param {string[]} versions the versions already released, of the package or its lockstep group
 */
export function nextPrerelease(version, label, versions) {
  if (!PRE_LABEL.test(label)) {
    throw new Error(`pre-release label "${label}" must be lower-case letters, such as rc`);
  }
  const prefix = `${version}-${label}.`;
  const taken = versions
    .filter((v) => v.startsWith(prefix) && /^\d+$/.test(v.slice(prefix.length)))
    .map((v) => Number(v.slice(prefix.length)));
  return `${version}-${label}.${Math.max(0, ...taken) + 1}`;
}
