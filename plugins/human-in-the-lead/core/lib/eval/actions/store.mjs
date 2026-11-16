// Actions for the store remote scenarios (design 0003 section 13): a project with a checkout on
// each device, a bare repository standing in for the store's host (its hitld-devices branch holds
// the devices' requests), and a bare repository standing in for the project's own origin. Who may
// read the store is the owner's answers to device decisions, inside each device's private store. Every device is a container: a
// fresh clone of origin, a private store of its own (a data directory of its own) and its key.
// A device's key and the store's address arrive the way a cloud environment's do, in
// HITLD_STORE_IDENTITY and HITLD_STORE_REMOTE; the keychain and the person file are not used, so
// a scenario runs on any machine. The project's repository never holds the address.
//
// Everything is built inside the sandbox. No action prints a private key: `init --cloud` prints
// one once, and `store.hitld` keeps it as the key of the device it names and leaves it out of the
// result. The commands themselves go through the real command line (`main`), so a scenario runs
// what an owner runs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateIdentity, decrypt, isAgeFile, parseIdentities } from '../../store/age.mjs';
import { APPROVALS_KEY, openDeviceAsks, readApprovals } from '../../store/devices.mjs';
import { DEVICES_BRANCH, PROPOSALS_DIR, STORE_BRANCH } from '../../store/remote-git.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
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

/** A device's private store. @param {string} sandbox @param {string} name */
const storeOf = (sandbox, name) =>
  openStore(privateStorePath(PROJECT_ID, { env: envFor(sandbox, name) }));

/** The device names asking on the host's hitld-devices branch. @param {string} gitDir */
function requestsOf(gitDir) {
  try {
    return bareGit(gitDir, [
      'ls-tree',
      '--name-only',
      `refs/heads/${DEVICES_BRANCH}`,
      `${PROPOSALS_DIR}/`,
    ])
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((p) => p.slice(PROPOSALS_DIR.length + 1).replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/** Whether the scenario's project has a store remote: its host exists. @param {string} sandbox */
const hasHost = (sandbox) => existsSync(join(hostDir(sandbox), 'HEAD'));

/**
 * The environment a command runs in on a device: its own data directory, and its key and the
 * store's address as a cloud environment carries them.
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
    ...(hasHost(sandbox) ? { HITLD_STORE_REMOTE: pathToFileURL(hostDir(sandbox)).href } : {}),
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
      "Build a project for the store remote: origin (a bare repository holding main, with policy.json and a tracker project for device decisions, and neither the store's address nor its devices), a bare repository standing in for the store's host, unless remote is false, and a container for each named device: a fresh clone, an empty private store, a key of its own and the store's address in HITLD_STORE_REMOTE. A device is enrolled when it is in `enrolled` (default: all of them): its own store holds the owner's approvals of the enrolled devices, as if it had pulled them. Returns { project, devices, enrolled, remote }.",
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
          ...(withRemote ? { store: { remote: { required: true } } } : {}),
        }),
        'work/projects/SAM-1-the-store-follows-the-owner.md':
          '---\nid: SAM-1\ntitle: "The store follows the owner"\nkind: project\nstate: planned\ncreated: 2026-11-15\n---\n\nWhere device decisions are filed.\n',
      });
      commitAll(seed, 'Set up the project');
      fixtureGit(ctx.sandbox, 'init', '-q', '--bare', '-b', 'main', originDir(ctx.sandbox));
      fixtureGit(seed, 'push', '-q', originDir(ctx.sandbox), 'main');
      rmSync(seed, { recursive: true, force: true });
      for (const name of devices) freshContainer(ctx.sandbox, name);
      // The owner's earlier answers, which every enrolled device has pulled: its own store says
      // which devices are approved.
      const approvals = enrolled
        .map((name, i) =>
          JSON.stringify({
            event: 'approved',
            decision: `SAM-${100 + i}`,
            action: 'enroll',
            name,
            recipient: recipients[name],
            added: '2026-11-15',
            at: `2026-11-15T09:0${i % 10}:00.000Z`,
          }),
        )
        .join('\n');
      for (const name of enrolled) {
        storeOf(ctx.sandbox, name).write(APPROVALS_KEY, `${approvals}\n`);
      }
      return {
        project: PROJECT_ID,
        devices,
        enrolled,
        remote: withRemote ? 'environment' : 'none',
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

  'store.owner-answers': {
    description:
      'The owner, in their own turn on a device, answers every device decision waiting there with `hitld rights answer <decision> --answer <answer>` (A approves, B refuses). Returns { answered }: each decision, and what the answer did to the device.',
    input: {
      type: 'object',
      properties: { device: DEVICE, answer: { enum: ['A', 'B'] } },
      required: ['device'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const name = checkName(input.device);
      const checkout = join(deviceDir(ctx.sandbox, name), 'checkout');
      const { main } = await import('../../cli/main.mjs');
      const answered = [];
      for (const ask of openDeviceAsks(readApprovals(storeOf(ctx.sandbox, name)))) {
        let out = '';
        await main(['rights', 'answer', ask.decision, '--answer', input.answer ?? 'A'], {
          out: (t) => (out += t),
          err: () => {},
          cwd: checkout,
          env: envFor(ctx.sandbox, name),
        });
        const r = JSON.parse(out);
        answered.push({ decision: ask.decision, ok: r.ok, device: r.device ?? null });
      }
      return { answered };
    },
  },

  'store.inspect-remote': {
    description:
      "Look at everything the store's host holds, as its provider could: every object of the bare repository, reachable or not. Returns { versions, all_age_files, names_ok, plain_hits, opens, requests }: the number of files kept on the store branch, whether each is an age file, whether each is named only by a sequence number and a hash, which of `markers` appear in any object as plain text, for each device in open_with how many of the files its key opens, and the device requests on the hitld-devices branch.",
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
        requests: made ? requestsOf(host) : [],
      };
    },
  },
};
