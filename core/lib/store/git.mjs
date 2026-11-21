// The private store's text history as a git repository (design part 3.2, Q1).
//
// The repository lives at <store>/.git. What syncs between machines is committed; what belongs to
// one machine is listed in MACHINE_LOCAL, kept out by the store's .gitignore, and refused when it
// arrives in a bundle. Commits are made when the store is exported or imported, not on every write.
//
// Trust boundary: git is the owner's own program, found on PATH. It always runs with an argument
// list (never a shell string), with GIT_DIR and GIT_WORK_TREE pinned to the store so no other
// repository is found, with the owner's global and system git config ignored (a signing or hook
// setting there cannot change what runs), and with hooks off (core.hooksPath=/dev/null) so nothing
// in the store or a bundle can run. The passphrase is never in git's environment. Git for Windows
// reads /dev/null in both places as its own empty device.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { hostEnv, removeFile, replaceFile } from './host.mjs';

/** The branch that holds the store's history. */
export const BRANCH = 'main';
/** Where a bundle's head is fetched to before it is merged. */
const INCOMING = 'refs/hitld/incoming';

/**
 * Store paths that stay on this machine: never committed, never exported, refused on import.
 * A trailing slash names a directory; a trailing star, any path that starts with the rest. The SQLite index is rebuilt from the text on each machine;
 * the run state and its checkpoints are rebuilt from the ledger (design part 13.1); the primary
 * checkout record, worktree records and usage snapshots describe this machine; the digest cursor
 * is what this machine has shown; the ledger writer names this machine's own ledger file, so a
 * store moved elsewhere writes a file of its own there (ledger/writer.mjs).
 */
export const MACHINE_LOCAL = Object.freeze([
  'index.sqlite*',
  'run-state.json',
  'run/',
  'primary-checkout.json',
  'env/',
  'usage/',
  'rights/digest.json',
  'ledger-writer.json',
]);

const GITIGNORE = [
  '# Written by hitld. Machine-local: never committed or exported (design part 3.2).',
  ...MACHINE_LOCAL.map((p) => `/${p}`),
  '*.tmp',
  '',
].join('\n');

export class StoreGitError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [detail] */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'StoreGitError';
    this.code = code;
    this.detail = detail;
  }
}

/** @param {string} path a store-relative path with forward slashes */
export const isMachineLocal = (path) =>
  path.endsWith('.tmp') ||
  MACHINE_LOCAL.some((p) =>
    p.endsWith('/')
      ? path.startsWith(p)
      : p.endsWith('*')
        ? path.startsWith(p.slice(0, -1))
        : path === p,
  );

/**
 * Run git on the store. Returns stdout as a Buffer.
 * @param {string} root the store directory
 * @param {string[]} args
 * @param {{ input?: Buffer | string, allowFail?: boolean }} [options]
 * @returns {{ ok: boolean, stdout: Buffer, stderr: string }}
 */
export function git(root, args, options = {}) {
  const env = {
    ...hostEnv(root),
    LANG: 'C',
    LC_ALL: 'C',
    GIT_DIR: join(root, '.git'),
    GIT_WORK_TREE: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'hitld',
    GIT_AUTHOR_EMAIL: 'hitld@localhost',
    GIT_COMMITTER_NAME: 'hitld',
    GIT_COMMITTER_EMAIL: 'hitld@localhost',
  };
  const full = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'commit.gpgSign=false',
    '-c',
    'core.autocrlf=false',
    ...args,
  ];
  try {
    const stdout = execFileSync('git', full, {
      cwd: root,
      env,
      input: options.input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    const err = /** @type {{ stdout?: Buffer, stderr?: Buffer, message: string }} */ (e);
    const stderr = err.stderr?.toString('utf8').trim() || err.message;
    if (options.allowFail) return { ok: false, stdout: err.stdout ?? Buffer.alloc(0), stderr };
    throw new StoreGitError('git-failed', `git ${args[0]} failed in the store: ${stderr}`);
  }
}

/** @param {string} root @param {string[]} args */
const gitText = (root, args) => git(root, args).stdout.toString('utf8').trim();

/**
 * Make the store a git repository if it is not one, and keep its .gitignore current.
 * @param {string} root
 */
export function ensureRepo(root) {
  const base = resolve(root);
  mkdirSync(base, { recursive: true });
  if (!existsSync(join(base, '.git'))) {
    git(base, ['init', '-q', `--initial-branch=${BRANCH}`]);
  }
  const ignore = join(base, '.gitignore');
  if (!existsSync(ignore) || readFileSync(ignore, 'utf8') !== GITIGNORE) {
    writeFileSync(ignore, GITIGNORE);
  }
  return base;
}

/** The commit at the head of the store's branch, or null before the first commit. @param {string} root */
export function head(root) {
  const r = git(root, ['rev-parse', '--verify', '-q', `refs/heads/${BRANCH}`], {
    allowFail: true,
  });
  return r.ok ? r.stdout.toString('utf8').trim() : null;
}

/**
 * Commit everything that syncs, if anything changed. Returns the head after.
 * @param {string} root @param {string} message
 */
export function snapshot(root, message) {
  ensureRepo(root);
  git(root, ['add', '-A']);
  const before = head(root);
  const clean =
    before !== null && git(root, ['diff', '--cached', '--quiet'], { allowFail: true }).ok;
  if (!clean) git(root, ['commit', '-q', '--no-verify', '-m', `${message} (on ${hostname()})`]);
  return /** @type {string} */ (head(root));
}

/**
 * Whether the store holds anything to sync besides its own .gitignore.
 * @param {string} root
 */
export function hasText(root) {
  ensureRepo(root);
  git(root, ['add', '-A']);
  const staged = git(root, ['ls-files', '-z']).stdout.toString('utf8').split('\0').filter(Boolean);
  return head(root) !== null || staged.some((p) => p !== '.gitignore');
}

/**
 * A bundle of the whole history of the store's branch.
 * @param {string} root @returns {Buffer}
 */
export function createBundle(root) {
  const tmp = scratch(root, 'out.bundle');
  try {
    git(root, ['bundle', 'create', '-q', tmp, `refs/heads/${BRANCH}`]);
    return readFileSync(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** A scratch file inside the store's .git directory, which holds the same data. @param {string} root @param {string} name */
function scratch(root, name) {
  const dir = join(root, '.git', 'hitld-tmp');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${process.pid}-${name}`);
}

/**
 * Verify a bundle against the store, then fetch its branch head. Nothing in the bundle runs:
 * hooks are off and objects are checked as they arrive (transfer.fsckObjects).
 * @param {string} root @param {Buffer} bundle @param {string} expectedHead the manifest's head
 * @returns {string} the fetched commit
 */
export function fetchBundle(root, bundle, expectedHead) {
  const tmp = scratch(root, 'in.bundle');
  writeFileSync(tmp, bundle, { mode: 0o600 });
  try {
    const verified = git(root, ['bundle', 'verify', '-q', tmp], { allowFail: true });
    if (!verified.ok) {
      throw new StoreGitError('bad-bundle', `the bundle does not verify: ${verified.stderr}`);
    }
    const heads = git(root, ['bundle', 'list-heads', tmp, `refs/heads/${BRANCH}`])
      .stdout.toString('utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split(' ')[0]);
    if (heads.length !== 1 || heads[0] !== expectedHead) {
      throw new StoreGitError(
        'bad-bundle',
        `the bundle's ${BRANCH} is ${heads.join(', ') || 'missing'}, but the manifest says ${expectedHead}`,
      );
    }
    git(root, [
      '-c',
      'transfer.fsckObjects=true',
      'fetch',
      '-q',
      '--no-tags',
      '--no-write-fetch-head',
      tmp,
      `+refs/heads/${BRANCH}:${INCOMING}`,
    ]);
    const got = gitText(root, ['rev-parse', '--verify', INCOMING]);
    if (got !== expectedHead) {
      throw new StoreGitError('bad-bundle', `fetched ${got}, expected ${expectedHead}`);
    }
    return got;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Drop the fetched ref. @param {string} root */
export const dropIncoming = (root) =>
  git(root, ['update-ref', '-d', INCOMING], { allowFail: true });

/**
 * @typedef {{ mode: string, sha: string }} TreeEntry
 * @typedef {{ path: string, why: string }} Conflict
 */

/** @param {string} root @param {string | null} commit @returns {Map<string, TreeEntry>} */
function tree(root, commit) {
  /** @type {Map<string, TreeEntry>} */
  const out = new Map();
  if (!commit) return out;
  const raw = git(root, ['ls-tree', '-r', '-z', '--full-tree', commit]).stdout.toString('utf8');
  for (const rec of raw.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [mode, , sha] = rec.slice(0, tab).split(' ');
    out.set(rec.slice(tab + 1), { mode, sha });
  }
  return out;
}

/**
 * Read blobs by ID in one `git cat-file --batch`, not a process each: starting a process costs
 * far more on some machines (Windows with endpoint protection: about 200 ms) than others, and a
 * merge can touch hundreds of files. A blob that is not there is an error, as `cat-file blob`.
 * @param {string} root @param {Iterable<string>} shas
 * @returns {Map<string, Buffer>}
 */
function blobs(root, shas) {
  /** @type {Map<string, Buffer>} */
  const out = new Map();
  const wanted = [...new Set(shas)];
  if (!wanted.length) return out;
  const buf = git(root, ['cat-file', '--batch'], { input: `${wanted.join('\n')}\n` }).stdout;
  // Per object: "<id> blob <size>\n<bytes>\n", or "<what was asked> missing\n".
  let at = 0;
  while (at < buf.length) {
    const eol = buf.indexOf(10, at);
    if (eol < 0) break;
    const [sha, type, size] = buf.subarray(at, eol).toString('utf8').split(' ');
    if (size === undefined) {
      at = eol + 1;
      continue;
    }
    const start = eol + 1;
    const end = start + Number(size);
    if (type === 'blob') out.set(sha, buf.subarray(start, end));
    at = end + 1;
  }
  const missing = wanted.find((sha) => !out.has(sha));
  if (missing !== undefined) {
    throw new StoreGitError('git-failed', `git cat-file failed in the store: no blob ${missing}`);
  }
  return out;
}

/**
 * The one merge base of two commits, or null for unrelated histories.
 * @param {string} root @param {string} a @param {string} b
 */
function mergeBase(root, a, b) {
  const r = git(root, ['merge-base', a, b], { allowFail: true });
  return r.ok ? r.stdout.toString('utf8').trim() : null;
}

/** @param {string} root @param {string} a @param {string} b whether a is an ancestor of b */
const isAncestor = (root, a, b) =>
  git(root, ['merge-base', '--is-ancestor', a, b], { allowFail: true }).ok;

/** @param {Buffer | null} buf @returns {string[]} */
const lines = (buf) => {
  if (!buf) return [];
  const text = buf.toString('utf8');
  const out = text.split('\n');
  if (out[out.length - 1] === '') out.pop();
  return out;
};

/** @param {string} line */
function lineInfo(line) {
  try {
    const v = JSON.parse(line);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return {
        id: typeof v.id === 'string' ? v.id : null,
        at: typeof v.at === 'string' ? v.at : '',
      };
    }
  } catch {
    // Not JSON (a torn line): it merges as text.
  }
  return { id: null, at: '' };
}

/**
 * Merge an append-only file (JSON lines) that both sides changed. Nothing the base held may be
 * gone from either side. The result keeps the lines both sides share, in our order, then the new
 * lines from both sides ordered by time and text, so two machines merging each other's history
 * write the same file. Two different lines with the same `id` are a conflict: one ID, two events.
 * @param {Buffer | null} base @param {Buffer} ours @param {Buffer} theirs
 * @returns {{ text: string } | { why: string }}
 */
export function mergeAppendOnly(base, ours, theirs) {
  const b = lines(base);
  const o = lines(ours);
  const t = lines(theirs);
  const oSet = new Set(o);
  const tSet = new Set(t);
  for (const [side, set] of /** @type {const} */ ([
    ['this store', oSet],
    ['the imported store', tSet],
  ])) {
    const lost = b.find((l) => !set.has(l));
    if (lost !== undefined) {
      return { why: `a line was removed or changed in ${side}; this file is append-only` };
    }
  }
  const kept = [...new Set(o.filter((l) => tSet.has(l)))];
  const fresh = [...new Set([...o.filter((l) => !tSet.has(l)), ...t.filter((l) => !oSet.has(l))])]
    .map((l) => ({ l, ...lineInfo(l) }))
    .sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.l < y.l ? -1 : x.l > y.l ? 1 : 0));
  /** @type {Map<string, string>} */
  const byId = new Map();
  for (const l of kept) {
    const { id } = lineInfo(l);
    if (id !== null) byId.set(id, l);
  }
  for (const { l, id } of fresh) {
    if (id === null) continue;
    const other = byId.get(id);
    if (other !== undefined && other !== l) {
      return { why: `${id} was written with different content on each side` };
    }
    byId.set(id, l);
  }
  const all = [...kept, ...fresh.map((f) => f.l)];
  return { text: all.length ? all.join('\n') + '\n' : '' };
}

/**
 * Merge the fetched head into the store's branch and update the files. Per path: a side that did
 * not change it takes the other side's; both changing it the same way is fine; both changing an
 * append-only file (.jsonl) merges its lines; anything else is a conflict, and nothing is written.
 * @param {string} root
 * @param {string} theirs the fetched commit
 * @returns {{ result: 'up-to-date' | 'fast-forward' | 'merged', head: string, changed: string[] } | { result: 'conflict', conflicts: Conflict[] }}
 */
export function mergeIncoming(root, theirs) {
  // No commit yet: a store that held nothing to sync takes the imported history as it is.
  const ours = head(root);
  if (ours && isAncestor(root, theirs, ours))
    return { result: 'up-to-date', head: ours, changed: [] };
  const base = ours ? mergeBase(root, ours, theirs) : null;
  const [tb, to, tt] = [tree(root, base), tree(root, ours), tree(root, theirs)];

  /** @type {Conflict[]} */
  const conflicts = [];
  for (const [path, e] of tt) {
    if (!['100644', '100755'].includes(e.mode)) {
      conflicts.push({ path, why: `mode ${e.mode} is not a plain file; refused` });
    } else if (path === '.gitignore') {
      // Ours always: which paths stay on this machine is this version's call.
    } else if (isMachineLocal(path)) {
      conflicts.push({ path, why: 'is machine-local and must not arrive from another machine' });
    } else if (!safeRelative(path)) {
      conflicts.push({ path, why: 'is not a safe store path; refused' });
    }
  }
  if (conflicts.length) return { result: 'conflict', conflicts };

  // First what each path needs, then every blob that takes in one read.
  /** @type {({ path: string, take: string | null } | { path: string, base: string | null, ours: string, theirs: string } | { path: string, why: string })[]} */
  const plan = [];
  const paths = new Set([...tb.keys(), ...to.keys(), ...tt.keys()]);
  for (const path of [...paths].sort()) {
    if (path === '.gitignore') continue;
    const [b, o, t] = [tb.get(path)?.sha ?? null, to.get(path)?.sha ?? null, tt.get(path)?.sha];
    const ts = t ?? null;
    if (o === ts || b === ts) continue; // the same, or only we changed it
    if (b === o) {
      plan.push({ path, take: ts });
      continue;
    }
    if (path.endsWith('.jsonl') && o !== null && ts !== null) {
      plan.push({ path, base: b, ours: o, theirs: ts });
      continue;
    }
    plan.push({
      path,
      why:
        o === null || ts === null
          ? 'deleted on one side and changed on the other'
          : 'changed on both sides',
    });
  }
  /** @type {string[]} */
  const needed = [];
  for (const p of plan) {
    if ('why' in p) continue;
    if ('take' in p) {
      if (p.take !== null) needed.push(p.take);
    } else needed.push(...(p.base ? [p.base] : []), p.ours, p.theirs);
    // What this store committed there, to check against before writing.
    const committed = to.get(p.path)?.sha;
    if (committed !== undefined) needed.push(committed);
  }
  const read = blobs(root, needed);
  const blob = (/** @type {string} */ sha) => /** @type {Buffer} */ (read.get(sha));

  /** @type {Map<string, Buffer | null>} what to write (null: delete) */
  const writes = new Map();
  for (const p of plan) {
    if ('why' in p) {
      conflicts.push({ path: p.path, why: p.why });
    } else if ('take' in p) {
      writes.set(p.path, p.take === null ? null : blob(p.take));
    } else {
      const m = mergeAppendOnly(p.base ? blob(p.base) : null, blob(p.ours), blob(p.theirs));
      if ('why' in m) conflicts.push({ path: p.path, why: m.why });
      else writes.set(p.path, Buffer.from(m.text));
    }
  }
  if (conflicts.length) return { result: 'conflict', conflicts };

  // Write only what this store still holds as we committed it a moment ago.
  for (const path of writes.keys()) {
    const file = join(root, ...path.split('/'));
    const now = existsSync(file) ? readFileSync(file) : null;
    const sha = to.get(path)?.sha;
    const committed = sha === undefined ? null : blob(sha);
    if ((now === null) !== (committed === null) || (now && committed && !now.equals(committed))) {
      throw new StoreGitError(
        'store-changed',
        `${path} changed in the store during the import; nothing was merged, run it again`,
      );
    }
  }
  for (const [path, content] of writes) {
    const file = join(root, ...path.split('/'));
    if (content === null) {
      if (existsSync(file)) removeFile(file);
    } else {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, content);
      replaceFile(tmp, file);
    }
  }
  git(root, ['add', '-A']);
  const merged = gitText(root, ['write-tree']);
  const theirsTree = gitText(root, ['rev-parse', `${theirs}^{tree}`]);
  /** @type {string} */
  let next;
  /** @type {'fast-forward' | 'merged'} */
  let result;
  if (base === ours && merged === theirsTree) {
    next = theirs;
    result = 'fast-forward';
  } else {
    const parents = ours ? ['-p', ours, '-p', theirs] : ['-p', theirs];
    next = gitText(root, [
      'commit-tree',
      merged,
      ...parents,
      '-m',
      `merge an imported store (on ${hostname()})`,
    ]);
    result = 'merged';
  }
  // The old value guards against another writer moving the branch meanwhile ('' means none yet).
  git(root, ['update-ref', `refs/heads/${BRANCH}`, next, ours ?? '']);
  // The index now matches the new head's tree.
  git(root, ['read-tree', next]);
  return { result, head: next, changed: [...writes.keys()] };
}

/** @param {string} path */
function safeRelative(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.toLowerCase() === '.git')) {
    return false;
  }
  return !resolve('/s', path).split(sep).includes('..');
}
