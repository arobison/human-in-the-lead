// Actions for the store remote scenarios (design 0003 section 13): a project with a checkout on
// each device, a bare repository standing in for the store's host, and a bare repository standing
// in for the project's own origin (where the owner's merge lands). Every device is a container: a
// fresh clone of origin, a private store of its own (a data directory of its own) and its key.
// A device's key arrives the way a cloud environment's does, in HITLD_STORE_IDENTITY; the
// keychain is not used, so a scenario runs on any machine.
//
// Everything is built inside the sandbox. No action prints a private key: `init --cloud` prints
// one once, and `store.hitld` keeps it as the key of the device it names and leaves it out of the
// result. The commands themselves go through the real command line (`main`), so a scenario runs
// what an owner runs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateIdentity, decrypt, isAgeFile, parseIdentities } from '../../store/age.mjs';
import { DEVICES_PATH, serializeDevices } from '../../store/devices.mjs';
import { STORE_BRANCH } from '../../store/remote-git.mjs';
import { commitAll, fixtureGit, putFiles } from '../orchestrator-fixtures.mjs';

const PROJECT_ID = 'sample-app';

/** @param {string} sandbox @param {string} name */
const deviceDir = (sandbox, name) => join(sandbox, 'devices', name);
/** @param {string} sandbox */
const originDir = (sandbox) => join(sandbox, 'origin.git');
/** @param {string} sandbox */
const hostDir = (sandbox) => join(sandbox, 'host', 'store.git');

/** @param {string} name */
function checkName(name) {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) throw new Error(`"${name}" is not a device name`);
  return name;
}

/**
 * The device's key, or null when it has none.
 * @param {string} sandbox @param {string} name
 */
function readKey(sandbox, name) {
  const file = join(deviceDir(sandbox, name), 'identity');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

/** @param {string} sandbox @param {string} name @param {string} identity */
function writeKey(sandbox, name, identity) {
  mkdirSync(deviceDir(sandbox, name), { recursive: true });
  writeFileSync(join(deviceDir(sandbox, name), 'identity'), `${identity}\n`, { mode: 0o600 });
}

/**
 * A fresh container for a device: a clone of origin's main, and a private store that is empty.
 * @param {string} sandbox @param {string} name
 */
function freshContainer(sandbox, name) {
  const dir = deviceDir(sandbox, name);
  for (const part of ['checkout', 'data', 'config', 'home']) {
    rmSync(join(dir, part), { recursive: true, force: true });
  }
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'home'), { recursive: true });
  const checkout = join(dir, 'checkout');
  fixtureGit(dir, 'clone', '-q', originDir(sandbox), checkout);
  fixtureGit(checkout, 'config', 'user.name', 'Owner');
  fixtureGit(checkout, 'config', 'user.email', 'owner@example.invalid');
  fixtureGit(checkout, 'config', 'commit.gpgsign', 'false');
  return checkout;
}

/** The devices that have a container, as directories. @param {string} sandbox */
function containers(sandbox) {
  const dir = join(sandbox, 'devices');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, 'checkout')));
}

/**
 * The environment a command runs in on a device: its own data directory, and its key as a cloud
 * environment carries it.
 * @param {string} sandbox @param {string} name
 * @param {{ executor?: boolean, noKey?: boolean }} [o]
 * @returns {NodeJS.ProcessEnv}
 */
function envFor(sandbox, name, o = {}) {
  const dir = deviceDir(sandbox, name);
  const key = o.noKey ? null : readKey(sandbox, name);
  return {
    PATH: process.env.PATH,
    HOME: join(dir, 'home'),
    XDG_DATA_HOME: join(dir, 'data'),
    XDG_CONFIG_HOME: join(dir, 'config'),
    HITLD_SESSION: `s-${name}`,
    ...(key ? { HITLD_STORE_IDENTITY: key } : {}),
    ...(o.executor ? { HITLD_ROLE: 'executor', HITLD_DISPATCH: 'D-1' } : {}),
  };
}

const DEVICE = { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' };

/**
 * Run git against a bare repository, as an observer: nothing of the owner's configuration, and
 * what git says about a missing ref stays out of the scenario's output.
 * @param {string} gitDir @param {string[]} args @param {string} [input]
 */
const bareGit = (gitDir, args, input) =>
  execFileSync('git', ['--git-dir', gitDir, ...args], {
    input,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });

/**
 * Every object of a bare repository, raw, with its type.
 * @param {string} gitDir
 * @returns {{ type: string, content: Buffer }[]}
 */
function allObjects(gitDir) {
  /** @param {string[]} args @param {string} [input] */
  const git = (args, input) => bareGit(gitDir, args, input);
  const ids = git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'])
    .toString('utf8')
    .split('\n')
    .filter(Boolean);
  if (!ids.length) return [];
  const raw = git(['cat-file', '--batch'], `${ids.join('\n')}\n`);
  /** @type {{ type: string, content: Buffer }[]} */
  const out = [];
  let at = 0;
  while (at < raw.length) {
    const eol = raw.indexOf(0x0a, at);
    const [, type, size] = raw.toString('utf8', at, eol).split(' ');
    const start = eol + 1;
    out.push({ type, content: raw.subarray(start, start + Number(size)) });
    at = start + Number(size) + 1;
  }
  return out;
}

/** Whether the bare repository has the store branch. @param {string} gitDir */
function hasBranch(gitDir) {
  try {
    bareGit(gitDir, ['show-ref', '--verify', '--quiet', `refs/heads/${STORE_BRANCH}`]);
    return true;
  } catch {
    return false;
  }
}

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'store.fixture': {
    description:
      "Build a project for the store remote: origin (a bare repository holding main, with policy.json and the list of enrolled devices), a bare repository standing in for the store's host (the project's store.remote.url, unless remote is false), and a container for each named device: a fresh clone, an empty private store and a key of its own. A device is enrolled when it is in `enrolled` (default: all of them). Returns { project, devices, enrolled, remote }.",
    input: {
      type: 'object',
      properties: {
        devices: { type: 'array', items: DEVICE, minItems: 1, uniqueItems: true },
        enrolled: { type: 'array', items: DEVICE, uniqueItems: true },
        remote: { type: 'boolean' },
      },
      required: ['devices'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      /** @type {string[]} */
      const devices = input.devices.map(checkName);
      /** @type {string[]} */
      const enrolled = input.enrolled ?? devices;
      for (const n of enrolled) {
        if (!devices.includes(n)) throw new Error(`enrolled device "${n}" is not a device`);
      }
      /** @type {Record<string, string>} */
      const recipients = {};
      for (const name of devices) {
        const made = generateIdentity();
        writeKey(ctx.sandbox, name, made.identity);
        recipients[name] = made.recipient;
      }
      const host = hostDir(ctx.sandbox);
      const withRemote = input.remote !== false;
      if (withRemote) {
        mkdirSync(host, { recursive: true });
        fixtureGit(host, 'init', '-q', '--bare');
      }
      const seed = join(ctx.sandbox, 'seed');
      mkdirSync(seed, { recursive: true });
      fixtureGit(seed, 'init', '-q', '-b', 'main');
      fixtureGit(seed, 'config', 'user.name', 'Owner');
      fixtureGit(seed, 'config', 'user.email', 'owner@example.invalid');
      fixtureGit(seed, 'config', 'commit.gpgsign', 'false');
      putFiles(seed, {
        '.human-in-the-lead/policy.json': JSON.stringify({
          schema_version: 1,
          project: { id: PROJECT_ID, key: 'SAM' },
          ...(withRemote ? { store: { remote: { url: `file://${host}` } } } : {}),
        }),
        [DEVICES_PATH]: serializeDevices({
          schema_version: 1,
          devices: enrolled.map((name) => ({
            name,
            recipient: recipients[name],
            added: '2026-11-15',
          })),
        }),
      });
      commitAll(seed, 'Set up the project and enrol its devices');
      fixtureGit(ctx.sandbox, 'init', '-q', '--bare', '-b', 'main', originDir(ctx.sandbox));
      fixtureGit(seed, 'push', '-q', originDir(ctx.sandbox), 'main');
      rmSync(seed, { recursive: true, force: true });
      for (const name of devices) freshContainer(ctx.sandbox, name);
      return {
        project: PROJECT_ID,
        devices,
        enrolled,
        remote: withRemote ? 'policy' : 'none',
      };
    },
  },

  'store.session': {
    description:
      "Start a new container for a device: a fresh clone of origin's main and an empty private store, as a new cloud session has. Its key is the device's own, or, with key_from, the key of another device: one cloud environment has one key, and every session in it shares it. Returns { device, key }.",
    input: {
      type: 'object',
      properties: { device: DEVICE, key_from: DEVICE },
      required: ['device'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const name = checkName(input.device);
      if (input.key_from) {
        const key = readKey(ctx.sandbox, checkName(input.key_from));
        if (!key) throw new Error(`"${input.key_from}" has no key`);
        writeKey(ctx.sandbox, name, key);
      }
      freshContainer(ctx.sandbox, name);
      return { device: name, key: readKey(ctx.sandbox, name) ? 'set' : 'none' };
    },
  },

  'store.discard': {
    description:
      "Discard a device's container, as the end of a cloud session does: its checkout and its private store are gone. Its key, which lives in the environment's settings and not in the container, stays. Returns { device, store_present }.",
    input: {
      type: 'object',
      properties: { device: DEVICE },
      required: ['device'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const dir = deviceDir(ctx.sandbox, checkName(input.device));
      for (const part of ['checkout', 'data', 'config', 'home']) {
        rmSync(join(dir, part), { recursive: true, force: true });
      }
      return { device: input.device, store_present: existsSync(join(dir, 'data')) };
    },
  },

  'store.hitld': {
    description:
      "Run a hitld command on a device, in its checkout and with its own private store and key (HITLD_STORE_IDENTITY). With as_executor it runs as a dispatched executor would. With no_key the device has no key set. With capture_key_for, a private key the command prints (`store device init --cloud`) is kept as the key of that device and left out of the result, as an owner puts it in the cloud environment's settings. Returns { exit, result }.",
    input: {
      type: 'object',
      properties: {
        device: DEVICE,
        argv: { type: 'array', items: { type: 'string' }, minItems: 1 },
        as_executor: { type: 'boolean' },
        no_key: { type: 'boolean' },
        capture_key_for: DEVICE,
      },
      required: ['device', 'argv'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const name = checkName(input.device);
      const checkout = join(deviceDir(ctx.sandbox, name), 'checkout');
      if (!existsSync(checkout)) throw new Error(`device "${name}" has no container`);
      const { main } = await import('../../cli/main.mjs');
      let out = '';
      const exit = await main(input.argv, {
        out: (t) => (out += t),
        err: () => {},
        cwd: checkout,
        env: envFor(ctx.sandbox, name, { executor: input.as_executor, noKey: input.no_key }),
      });
      /** @type {any} */
      let result;
      try {
        result = JSON.parse(out);
      } catch {
        result = { text: out };
      }
      if (result && typeof result === 'object' && typeof result.identity === 'string') {
        if (input.capture_key_for) {
          writeKey(ctx.sandbox, checkName(input.capture_key_for), result.identity);
        }
        result = { ...result, identity: '[a private key, kept out of the result]' };
      }
      return { exit, result };
    },
  },

  'store.owner-merge': {
    description:
      "The owner's merge: commit what a device changed under .human-in-the-lead (the device list, policy.json) to main, push it to origin, and bring every other container's main up to date, as a session does when it clones. Returns { merged, files }.",
    input: {
      type: 'object',
      properties: { device: DEVICE, message: { type: 'string', minLength: 1 } },
      required: ['device'],
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const name = checkName(input.device);
      const checkout = join(deviceDir(ctx.sandbox, name), 'checkout');
      fixtureGit(checkout, 'add', '-A', '.human-in-the-lead');
      const staged = fixtureGit(checkout, 'diff', '--cached', '--name-only')
        .split('\n')
        .filter(Boolean);
      if (!staged.length) return { merged: false, files: [] };
      fixtureGit(checkout, 'commit', '-q', '-m', input.message ?? 'Merge a store change');
      fixtureGit(checkout, 'push', '-q', 'origin', 'main');
      for (const other of containers(ctx.sandbox)) {
        if (other === name) continue;
        const dir = join(deviceDir(ctx.sandbox, other), 'checkout');
        fixtureGit(dir, 'fetch', '-q', 'origin');
        fixtureGit(dir, 'merge', '-q', '--ff-only', 'origin/main');
      }
      return { merged: true, files: staged };
    },
  },

  'store.inspect-remote': {
    description:
      "Look at everything the store's host holds, as its provider could: every object of the bare repository, reachable or not. Returns { versions, all_age_files, names_ok, plain_hits, opens }: the number of files kept on the store branch, whether each is an age file, whether each is named only by a sequence number and a hash, which of `markers` appear in any object as plain text, and, for each device in open_with, how many of the files its key opens.",
    input: {
      type: 'object',
      properties: {
        markers: { type: 'array', items: { type: 'string', minLength: 3 } },
        open_with: { type: 'array', items: DEVICE, uniqueItems: true },
      },
      additionalProperties: false,
    },
    run: (input, ctx) => {
      const host = hostDir(ctx.sandbox);
      const made = existsSync(join(host, 'HEAD'));
      const branch = made && hasBranch(host);
      const names = branch
        ? bareGit(host, ['ls-tree', '-r', '--name-only', STORE_BRANCH])
            .toString('utf8')
            .split('\n')
            .filter(Boolean)
        : [];
      const files = names.map((n) => ({
        name: n,
        bytes: bareGit(host, ['cat-file', 'blob', `${STORE_BRANCH}:${n}`]),
      }));
      const hits = new Set();
      for (const o of made ? allObjects(host) : []) {
        for (const m of input.markers ?? []) {
          if (o.content.includes(Buffer.from(m))) hits.add(m);
        }
      }
      /** @type {Record<string, number>} */
      const opens = {};
      for (const device of input.open_with ?? []) {
        const key = readKey(ctx.sandbox, checkName(device));
        if (!key) throw new Error(`"${device}" has no key`);
        const identities = parseIdentities(key);
        opens[device] = files.filter((f) => {
          try {
            decrypt(f.bytes, identities);
            return true;
          } catch {
            return false;
          }
        }).length;
      }
      return {
        versions: files.length,
        all_age_files: files.length > 0 && files.every((f) => isAgeFile(f.bytes)),
        names_ok:
          files.length > 0 &&
          files.every((f) => /^bundles\/\d{8}-[0-9a-f]{64}\.bundle$/.test(f.name)),
        plain_hits: [...hits].sort(),
        opens,
      };
    },
  },
};
