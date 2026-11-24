// Ecosystem profiles (HITLD-886, 910, 911, HITLD-920): a build system's ecosystem described as
// data, and the explicit mapping of profiles to paths in policy.json `ecosystems`.
//
// A profile holds manifests, lockfiles, version sources, folders to skip and caches; never a
// command. The built-in profiles ship in profiles.json beside this file and are validated against
// schemas/ecosystem-profiles.schema.json, which is not an owner configuration schema, so it cannot
// mark a property as run (x-hitld-executes) and any code-running key in a profile is refused: a
// shipped profile can never run anything. The install, build, test and publish commands appear
// only in policy.json `ecosystems.use`, which the owner writes.
//
// Nothing is detected at run time: the profile for a file is the `ecosystems.use` entry whose
// glob matches it most specifically, as for release packages.

import { lstatSync, readFileSync } from 'node:fs';
import { globMatch, safePath } from '../precedent/glob.mjs';
import { specificity } from '../release/packages.mjs';
import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';
import { insidePath } from '../tracker/files/safe.mjs';

/**
 * @typedef {{ file: string, format: 'json' | 'toml' | 'properties', key: string }} VersionSource
 * @typedef {{ name: string, variable: string }} Cache
 * @typedef {object} Profile
 * @property {string} name
 * @property {string} [extends] a project profile's built-in base
 * @property {string[]} manifests
 * @property {string[]} lockfiles
 * @property {VersionSource[]} version_sources
 * @property {string[]} skip_folders
 * @property {Cache[]} caches
 * @typedef {{ install?: string[], build?: string[], test?: string[], publish?: string[] }} Commands
 * @typedef {{ profile: string, paths: string[], commands?: Commands }} Use
 * @typedef {{ use?: Use[], profiles?: Partial<Profile>[] }} Ecosystems policy.json `ecosystems`
 */

/** The built-in profiles' file, shipped in the bundle. */
export const BUILTIN_PROFILES_FILE = new URL('./profiles.json', import.meta.url);

/** The lists a profile holds; a project profile's list replaces its base's. */
const LISTS = /** @type {const} */ ([
  'manifests',
  'lockfiles',
  'version_sources',
  'skip_folders',
  'caches',
]);

// A cache variable is set to a shared folder, so it must name only a cache folder: a variable that
// points a tool at a home folder, a configuration file, a shell, a compiler or a set of flags
// would let that folder's contents, or the value itself, change what the tool runs. Three rules,
// compared without regard to case (npm reads its variables in either case):

/**
 * 1. Tool namespaces. These tools read any of their settings from variables with these names
 * (npm_config_init_module, YARN_YARN_PATH, PIP_CONFIG_FILE, BUNDLE_APP_CONFIG, COMPOSER_HOME,
 * GOFLAGS, RUSTFLAGS, CARGO_HOME), so in a namespace only the tool's own cache variables are
 * accepted, and none in a namespace with no cache variable that is only a cache.
 * @type {{ re: RegExp, tool: string, caches: string[] }[]}
 */
const TOOL_NAMESPACES = [
  { re: /^NPM_/, tool: 'npm', caches: ['NPM_CONFIG_CACHE', 'NPM_CONFIG_STORE_DIR'] },
  { re: /^PNPM_/, tool: 'pnpm', caches: [] },
  { re: /^YARN_/, tool: 'yarn', caches: ['YARN_CACHE_FOLDER'] },
  { re: /^NODE_/, tool: 'node', caches: [] },
  { re: /^(CARGO|RUST)/, tool: 'cargo', caches: [] },
  { re: /^(GO[A-Z0-9]*|CGO_.*)$/, tool: 'go', caches: ['GOMODCACHE', 'GOCACHE'] },
  { re: /^PIP_/, tool: 'pip', caches: ['PIP_CACHE_DIR'] },
  { re: /^UV_/, tool: 'uv', caches: ['UV_CACHE_DIR'] },
  { re: /^POETRY_/, tool: 'poetry', caches: ['POETRY_CACHE_DIR'] },
  { re: /^(PYTHON|VIRTUAL_ENV)/, tool: 'python', caches: [] },
  { re: /^(MAVEN|M2_|MVN)/, tool: 'maven', caches: [] },
  { re: /^GRADLE/, tool: 'gradle', caches: [] },
  { re: /^(JAVA|_JAVA|JDK_)/, tool: 'java', caches: [] },
  { re: /^BUNDLE_/, tool: 'bundler', caches: ['BUNDLE_USER_CACHE'] },
  { re: /^(GEM_|RUBY)/, tool: 'ruby', caches: [] },
  { re: /^COMPOSER/, tool: 'composer', caches: ['COMPOSER_CACHE_DIR'] },
];

/** 2. Variables any tool may read as a home folder, configuration, a shell, a compiler or flags. */
const SHARED_CODE_VARIABLES =
  /^(PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|XDG_[A-Z_]+|SHELL|ENV|BASH_ENV|PROMPT_COMMAND|EDITOR|VISUAL|PAGER|LD_.*|DYLD_.*|GIT_.*|PERL5.*|CC|CXX|CPP|LD|AR|CFLAGS|CXXFLAGS|CPPFLAGS|LDFLAGS|MAKEFLAGS|PKG_CONFIG_PATH)$/;

/** 3. Any other variable whose name ends as a home, configuration, path, flags or a wrapper does. */
const CODE_SUFFIX =
  /(_HOME|_CONFIG|_CONFIG_FILE|_CONFIG_DIR|_CONFIG_PATH|RC|FLAGS|_OPTS|_OPTIONS|_ARGS|_PATH|_ENV|_BIN|_BIN_DIR|_WRAPPER|_PLUGINS)$/;

/**
 * Why a variable may not name a cache, or null if it may.
 * @param {string} variable @returns {string | null}
 */
export function cacheVariableProblem(variable) {
  const v = variable.toUpperCase();
  for (const ns of TOOL_NAMESPACES) {
    if (!ns.re.test(v) || ns.caches.includes(v)) continue;
    return ns.caches.length
      ? `a setting of ${ns.tool} other than its cache folder (${ns.caches.join(', ')}), and ${ns.tool} reads any of its settings from such variables, some of which change what it runs`
      : `a setting of ${ns.tool}, which reads settings from such variables that change what it runs, and ${ns.tool} has no variable that is only a cache folder`;
  }
  if (TOOL_NAMESPACES.some((ns) => ns.re.test(v))) return null;
  if (SHARED_CODE_VARIABLES.test(v)) {
    return 'read by tools as a home folder, configuration, a shell, a compiler or flags';
  }
  if (CODE_SUFFIX.test(v)) {
    return 'named as a home folder, configuration, a search path, flags or a wrapper is, which can change what a tool runs';
  }
  return null;
}

/**
 * Why a file or folder name is not a plain name, or null if it is: no separator, not `.` or `..`.
 * @param {string} name @returns {string | null}
 */
export function nameProblem(name) {
  if (/[/\\]/.test(name)) return 'has a path separator; give a folder name, not a path';
  if (name === '..' || name === '.') return `is ${name}; give a folder name`;
  if (name.includes('\0')) return 'has a NUL character';
  return null;
}

/**
 * Why a version source's file is not a repository path, or null if it is: relative to the
 * repository root, with no `..` segment and no `~`, and a file rather than a glob or the root.
 * @param {string} file @returns {string | null}
 */
export function repositoryPathProblem(file) {
  if (file.startsWith('~')) return `${JSON.stringify(file)} starts with ~, a home folder`;
  if (file.split(/[/\\]/).includes('..')) return `${JSON.stringify(file)} has a .. segment`;
  const r = safePath(file);
  if ('error' in r) return r.error;
  if (r.path === '') return `${JSON.stringify(file)} names the repository root, not a file`;
  if (/[*?]/.test(file)) return `${JSON.stringify(file)} is a glob, not a file`;
  return null;
}

/**
 * Problems with one profile's data, each beginning with `where`.
 * @param {Partial<Profile>} profile @param {string} where
 * @returns {string[]}
 */
export function profileProblems(profile, where) {
  /** @type {string[]} */
  const problems = [];
  for (const list of ['manifests', 'lockfiles']) {
    for (const name of /** @type {string[]} */ (profile[/** @type {'manifests'} */ (list)] ?? [])) {
      const p = nameProblem(name);
      if (p) problems.push(`${where}: ${list} ${JSON.stringify(name)} ${p}`);
    }
  }
  for (const name of profile.skip_folders ?? []) {
    const p = nameProblem(name);
    if (p) problems.push(`${where}: skip folder ${JSON.stringify(name)} ${p}`);
  }
  for (const v of profile.version_sources ?? []) {
    const p = repositoryPathProblem(v.file);
    if (p) problems.push(`${where}: version source ${v.file} is not a repository path: ${p}`);
  }
  for (const c of profile.caches ?? []) {
    const p = cacheVariableProblem(c.variable);
    if (p) {
      problems.push(
        `${where}: cache ${c.name} is named by ${c.variable}, which is ${p}; a cache variable must name only a cache folder`,
      );
    }
  }
  return problems;
}

/** @type {Map<string, Profile> | undefined} */
let builtins;

/**
 * The built-in profiles by name, read and validated once. A shipped file that does not validate
 * is a broken build, so it throws.
 * @param {{ file?: URL | string, registry?: import('../schema/registry.mjs').SchemaRegistry }} [options]
 *   file and registry are for tests; given a file, the result is not cached
 * @returns {Map<string, Profile>}
 */
export function builtinProfiles(options = {}) {
  if (!options.file && builtins) return builtins;
  const file = options.file ?? BUILTIN_PROFILES_FILE;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const problems = builtinProblems(data, options.registry);
  if (problems.length) {
    throw new Error(`the built-in ecosystem profiles do not validate:\n${problems.join('\n')}`);
  }
  /** @type {Map<string, Profile>} */
  const out = new Map();
  for (const p of data.profiles) out.set(p.name, withLists(p));
  if (!options.file) builtins = out;
  return out;
}

/**
 * Problems with a built-in profiles file: its schema, each profile's data, no `extends` and no
 * repeated name.
 * @param {unknown} data
 * @param {import('../schema/registry.mjs').SchemaRegistry} [registry]
 * @returns {string[]}
 */
export function builtinProblems(data, registry = schemas()) {
  const errors = registry.validate('ecosystem-profiles', data);
  if (errors.length) return formatErrors(errors, 'profiles.json').split('\n');
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  for (const p of /** @type {{ profiles: Partial<Profile>[] }} */ (data).profiles) {
    const where = `built-in profile ${p.name}`;
    if (seen.has(p.name)) problems.push(`${where}: is listed twice`);
    seen.add(p.name);
    if (p.extends !== undefined) problems.push(`${where}: a built-in profile extends nothing`);
    problems.push(...profileProblems(p, where));
  }
  return problems;
}

/** @param {Partial<Profile>} p @returns {Profile} */
function withLists(p) {
  const out = /** @type {Profile} */ ({ name: String(p.name) });
  if (p.extends !== undefined) out.extends = p.extends;
  for (const list of LISTS) out[list] = /** @type {any} */ (structuredClone(p[list] ?? []));
  return out;
}

/**
 * Every profile a policy can name, by name: the built-in ones, then the project's own, each of
 * those starting from the built-in it extends. Call checkEcosystems first; a project profile that
 * repeats a name or extends an unknown one is skipped here.
 * @param {Ecosystems | undefined} ecosystems
 * @param {Map<string, Profile>} [base] the built-in profiles
 * @returns {Map<string, Profile>}
 */
export function resolveProfiles(ecosystems, base = builtinProfiles()) {
  const out = new Map(base);
  for (const p of ecosystems?.profiles ?? []) {
    const name = String(p.name);
    if (out.has(name)) continue;
    const parent = p.extends === undefined ? undefined : base.get(p.extends);
    if (p.extends !== undefined && !parent) continue;
    /** @type {Profile} */
    const merged = withLists(parent ?? { name });
    merged.name = name;
    if (p.extends !== undefined) merged.extends = p.extends;
    for (const list of LISTS) {
      if (p[list] !== undefined) merged[list] = /** @type {any} */ (structuredClone(p[list]));
    }
    out.set(name, merged);
  }
  return out;
}

/**
 * Problems with policy.json `ecosystems`, for `hitld work check`: an unknown profile, a project
 * profile that repeats a name or extends one that is not built in, a version-source file that is
 * not a repository path, a skip folder with a separator or `..`, a cache named by a variable that
 * can change what a tool runs, and a path glob that can never match or matches less than it says
 * (see usePathProblem).
 * @param {Ecosystems | undefined} ecosystems
 * @param {Map<string, Profile>} [base] the built-in profiles
 * @param {{ root?: string }} [options] root: also refuse a glob that names a folder in it
 * @returns {string[]}
 */
export function checkEcosystems(ecosystems, base = builtinProfiles(), { root } = {}) {
  /** @type {string[]} */
  const problems = [];
  const own = new Set();
  (ecosystems?.profiles ?? []).forEach((p, i) => {
    const where = `policy.json ecosystems.profiles[${i}] ${p.name}`;
    if (base.has(String(p.name))) {
      problems.push(
        `${where}: is the name of a built-in profile; give the project's profile its own name, with extends: "${p.name}" to start from it`,
      );
    } else if (own.has(p.name)) {
      problems.push(`${where}: is declared twice`);
    }
    own.add(p.name);
    if (p.extends !== undefined && !base.has(p.extends)) {
      problems.push(
        `${where}: extends ${p.extends}, which is not a built-in profile (built-in: ${[...base.keys()].join(', ')})`,
      );
    }
    problems.push(...profileProblems(p, where));
  });
  (ecosystems?.use ?? []).forEach((u, i) => {
    const where = `policy.json ecosystems.use[${i}]`;
    if (!base.has(u.profile) && !own.has(u.profile)) {
      problems.push(
        `${where}: profile ${u.profile} is unknown: not a built-in profile (${[...base.keys()].join(', ')}) or one of ecosystems.profiles`,
      );
    }
    for (const g of u.paths) {
      const p = usePathProblem(g, root);
      if (p) problems.push(`${where}: path ${JSON.stringify(g)} ${p}`);
    }
  });
  return problems;
}

/**
 * Why an `ecosystems.use` glob can never match a repository path, or matches less than it says,
 * or null if neither: a backslash (globs use /), a `..` segment, a path that is absolute or starts
 * with ~, a trailing /, or, with `root`, a bare folder such as `web`, which matches only a file
 * named web, not what is in the folder.
 * @param {string} glob @param {string} [root] the repository root
 * @returns {string | null}
 */
export function usePathProblem(glob, root) {
  if (glob.includes('\\')) return 'has a backslash, which never matches; globs use / separators';
  if (glob.split('/').includes('..'))
    return 'has a .. segment, which never matches a repository path';
  if (glob.startsWith('~')) return 'starts with ~, a home folder, not the repository';
  const r = safePath(glob.replace(/\*+/g, 'x'));
  if ('error' in r) return r.error;
  const folder = glob.replace(/\/+$/, '');
  if (folder !== glob) {
    return `ends with /, which matches nothing; write ${folder}/** for everything under the folder`;
  }
  if (root && !/[*?]/.test(glob)) {
    let isFolder = false;
    try {
      isFolder = lstatSync(insidePath(root, glob)).isDirectory();
    } catch {
      // A path that crosses a link or is not there is not a folder in the repository.
    }
    if (isFolder) {
      return `is a folder, and a glob without a wildcard matches only a file of that name; write ${glob}/** for everything under it`;
    }
  }
  return null;
}

/**
 * The `ecosystems.use` entries that apply to a file, each with its resolved profile: those whose
 * globs match it, keeping only the most specific match when several do. Two entries tie only
 * when their best globs are equally specific, as for a repository root that is both an npm and a
 * Python project.
 * @param {Ecosystems | undefined} ecosystems
 * @param {string} file a path relative to the repository root
 * @param {Map<string, Profile>} [base] the built-in profiles
 * @returns {{ use: Use, profile: Profile }[]}
 */
export function profilesOfFile(ecosystems, file, base = builtinProfiles()) {
  const profiles = resolveProfiles(ecosystems, base);
  /** @type {{ use: Use, score: number }[]} */
  const hits = [];
  for (const u of ecosystems?.use ?? []) {
    const scores = u.paths.filter((g) => globMatch(g, file)).map(specificity);
    if (scores.length && profiles.has(u.profile)) hits.push({ use: u, score: Math.max(...scores) });
  }
  if (!hits.length) return [];
  const best = Math.max(...hits.map((h) => h.score));
  return hits
    .filter((h) => h.score === best)
    .map((h) => ({ use: h.use, profile: /** @type {Profile} */ (profiles.get(h.use.profile)) }));
}
