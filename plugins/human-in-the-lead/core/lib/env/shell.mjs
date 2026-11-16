// How to start a shell command or a program the same way on every platform.
//
// Policy shell commands (env.worktree_setup and the like) are written for a POSIX shell: the
// documented example is `node "$HITLD_PRIMARY_ROOT/..."`, which cmd.exe does not expand. On
// Windows they run with the bash of Git for Windows, which every hitld machine has because git is
// a hard dependency; cmd.exe is the fallback only when that bash cannot be found, with a note that
// says so. Elsewhere they run with /bin/sh -c, as Node's `shell: true` does.
//
// Programs given as an argument list are started without a shell. Windows cannot start a .cmd or
// .bat file (npm, npx, pnpm) or a script with a #! line that way, so on Windows those are mapped
// to the program that runs them: cmd.exe with every argument quoted and escaped, node, or bash.
//
// Other areas may use these (the merge queue and security scanners run policy commands too).

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';

const WIN = process.platform === 'win32';

/**
 * A program and its arguments, ready for spawn.
 * @typedef {object} SpawnSpec
 * @property {string} file
 * @property {string[]} args
 * @property {boolean} [windowsVerbatimArguments] the arguments are already quoted for cmd.exe
 * @property {Record<string, string>} [env] variables to add to the child's environment
 * @property {string} [note] how the command is being run, when it is not the usual way
 */

/**
 * A variable from an environment object, ignoring case on Windows (a copy of process.env there is
 * a plain object, so "Path" and "PATH" are different keys).
 * @param {NodeJS.ProcessEnv} env @param {string} name @returns {string | undefined}
 */
export function envValue(env, name) {
  if (env[name] !== undefined || !WIN) return env[name];
  const want = name.toUpperCase();
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() === want) return v;
  return undefined;
}

/** The Windows directory: %SystemRoot% when it holds cmd.exe, else C:\Windows. */
export function systemRoot(env = process.env) {
  for (const name of ['SystemRoot', 'windir']) {
    const v = envValue(env, name);
    if (v && isAbsolute(v) && existsSync(join(v, 'System32', 'cmd.exe'))) return v;
  }
  return 'C:\\Windows';
}

/** @param {string} path */
const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** @type {{ file: string, env?: Record<string, string> } | null | undefined} */
let bashFound;

/**
 * The bash of Git for Windows, found once per process: next to the git on PATH (git\cmd,
 * git\bin or git\mingw64\bin), else from `git --exec-path`, else in Program Files. Git's
 * bin\bash.exe sets up its own PATH; the plain usr\bin one is given usr\bin on PATH.
 * Null when there is none, and always null off Windows.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ file: string, env?: Record<string, string> } | null}
 */
export function gitBash(env = process.env) {
  if (!WIN) return null;
  if (bashFound !== undefined) return bashFound;
  /** @type {string[]} */
  const roots = [];
  for (const dir of (envValue(env, 'PATH') ?? '').split(delimiter)) {
    if (dir && isAbsolute(dir) && isFile(join(dir, 'git.exe'))) {
      // git\cmd, git\bin -> git; git\mingw64\bin -> git
      roots.push(resolve(dir, '..'), resolve(dir, '..', '..'));
    }
  }
  bashFound = bashUnder(roots);
  if (bashFound) return bashFound;
  // Only when PATH said nothing: asking git costs a process.
  try {
    // C:/Program Files/Git/mingw64/libexec/git-core -> C:/Program Files/Git
    const exec = execFileSync('git', ['--exec-path'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    if (exec) roots.push(resolve(exec, '..', '..', '..'));
  } catch {
    // no git on PATH: the Program Files guesses below
  }
  for (const name of ['ProgramFiles', 'ProgramW6432', 'LOCALAPPDATA']) {
    const base = envValue(env, name);
    if (base) roots.push(join(base, 'Git'), join(base, 'Programs', 'Git'));
  }
  bashFound = bashUnder(roots);
  return bashFound;
}

/**
 * The first bash under one of these Git for Windows roots.
 * @param {string[]} roots @returns {{ file: string, env?: Record<string, string> } | null}
 */
function bashUnder(roots) {
  for (const root of roots) {
    if (isFile(join(root, 'bin', 'bash.exe'))) return { file: join(root, 'bin', 'bash.exe') };
    const usr = join(root, 'usr', 'bin');
    if (isFile(join(usr, 'bash.exe'))) return { file: join(usr, 'bash.exe'), env: { PATH: usr } };
  }
  return null;
}

// cmd.exe quoting, as cross-spawn does it (https://qntm.org/cmd): quote for the program's own
// argument parser, then escape every character cmd.exe treats specially. An argument that reaches
// a .cmd file through %* is parsed by cmd.exe twice, so it is escaped twice.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** @param {string} arg @param {boolean} twice */
function cmdArg(arg, twice) {
  let a = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  a = `"${a}"`.replace(CMD_META, '^$1');
  return twice ? a.replace(CMD_META, '^$1') : a;
}

/**
 * Run a .cmd or .bat file through cmd.exe with every word quoted and escaped, so nothing in an
 * argument is read as a command. Line breaks cannot be passed to cmd.exe at all and are refused.
 * @param {string} script @param {string[]} args @param {NodeJS.ProcessEnv} env @returns {SpawnSpec}
 */
function viaCmd(script, args, env) {
  for (const a of [script, ...args]) {
    if (/[\r\n]/.test(a)) throw new Error('a .cmd or .bat program cannot take a line break');
  }
  const line = [script.replace(CMD_META, '^$1'), ...args.map((a) => cmdArg(a, true))].join(' ');
  return {
    file: join(systemRoot(env), 'System32', 'cmd.exe'),
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

/** The interpreter a script's #! line names, by its last word: node, sh or bash. @param {string} path */
function shebang(path) {
  let head = '';
  try {
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(256);
      head = buf.toString('utf8', 0, readSync(fd, buf, 0, 256, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  const m = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(head.split(/\r?\n/)[0]);
  if (!m) return null;
  const prog = m[1].split('/').at(-1) === 'env' ? m[2] : m[1].split('/').at(-1);
  return prog ?? null;
}

const RUNNABLE = ['.exe', '.com'];
const SHIMS = ['.cmd', '.bat'];

/**
 * Find a program the way Windows does: as given, then with each PATHEXT extension; a bare name is
 * looked up on the environment's PATH. Null when nothing matches.
 * @param {string} file @param {NodeJS.ProcessEnv} env
 */
function findOnWindows(file, env) {
  const exts = (envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map((e) => e.toLowerCase());
  /** @param {string} base */
  const pick = (base) => {
    if (extname(base) && isFile(base)) return base;
    for (const e of exts) if (isFile(base + e)) return base + e;
    return isFile(base) ? base : null;
  };
  if (isAbsolute(file) || /[\\/]/.test(file)) return pick(resolve(file));
  for (const dir of (envValue(env, 'PATH') ?? '').split(delimiter)) {
    if (!dir) continue;
    const found = pick(join(dir, file));
    if (found) return found;
  }
  return null;
}

/**
 * How to start a program with these arguments, without a shell. Off Windows, exactly as given. On
 * Windows: a .cmd or .bat file runs through cmd.exe, quoted; a script with a #! line for node, sh
 * or bash runs with node or Git's bash; a .js, .mjs or .cjs file runs with node; anything else is
 * started directly (a bare name is first looked up on PATH with PATHEXT).
 * @param {string[]} argv @param {NodeJS.ProcessEnv} [env] the child's environment
 * @returns {SpawnSpec}
 */
export function programSpec(argv, env = process.env) {
  const [file, ...args] = argv;
  if (!file) throw new Error('there is no program to run');
  if (!WIN) return { file, args };
  const found = findOnWindows(file, env) ?? findOnWindows(file, process.env);
  if (!found) return { file, args };
  const ext = extname(found).toLowerCase();
  if (SHIMS.includes(ext)) return viaCmd(found, args, env);
  if (RUNNABLE.includes(ext)) return { file: found, args };
  if (['.js', '.mjs', '.cjs'].includes(ext))
    return { file: process.execPath, args: [found, ...args] };
  const interpreter = shebang(found);
  if (interpreter === 'node') return { file: process.execPath, args: [found, ...args] };
  if (interpreter === 'sh' || interpreter === 'bash') {
    const bash = gitBash();
    if (bash) return withBashEnv(bash, [found, ...args], env);
  }
  return { file: found, args };
}

/**
 * @param {{ file: string, env?: Record<string, string> }} bash @param {string[]} args
 * @param {NodeJS.ProcessEnv} env @returns {SpawnSpec}
 */
function withBashEnv(bash, args, env) {
  if (!bash.env) return { file: bash.file, args };
  const path = envValue(env, 'PATH');
  return {
    file: bash.file,
    args,
    env: { PATH: path ? `${bash.env.PATH}${delimiter}${path}` : bash.env.PATH },
  };
}

/**
 * How to run a policy shell command. Off Windows: /bin/sh -c, as Node's `shell: true` does. On
 * Windows: Git's bash -c, or cmd.exe /d /s /c with a note when Git's bash cannot be found.
 * @param {string} command @param {NodeJS.ProcessEnv} [env] the child's environment
 * @returns {SpawnSpec}
 */
export function shellSpec(command, env = process.env) {
  if (!WIN) return { file: '/bin/sh', args: ['-c', command] };
  const bash = gitBash();
  if (bash) return withBashEnv(bash, ['-c', command], env);
  return {
    file: join(systemRoot(env), 'System32', 'cmd.exe'),
    args: ['/d', '/s', '/c', `"${command}"`],
    windowsVerbatimArguments: true,
    note: "Git for Windows' bash was not found, so this POSIX shell command ran with cmd.exe",
  };
}

/**
 * Options for spawn from a spec: the environment with the spec's additions, verbatim arguments
 * when quoted for cmd.exe, and no console window on Windows.
 * @param {SpawnSpec} spec @param {NodeJS.ProcessEnv} env
 * @returns {{ env: NodeJS.ProcessEnv, windowsVerbatimArguments?: boolean, windowsHide: boolean }}
 */
export function spawnOptions(spec, env) {
  /** @type {NodeJS.ProcessEnv} */
  let out = env;
  if (spec.env && WIN) {
    out = { ...env };
    for (const [k, v] of Object.entries(spec.env)) {
      // replace a differently cased key on Windows, so the child sees one PATH
      for (const key of Object.keys(out))
        if (key.toUpperCase() === k.toUpperCase()) delete out[key];
      out[k] = v;
    }
  }
  return {
    env: out,
    ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    windowsHide: true,
  };
}
