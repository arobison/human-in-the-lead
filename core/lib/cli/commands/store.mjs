// Moving and syncing the private store between machines (design part 3.2, Q1). Owner only.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { privateStorePath } from '../../store/store.mjs';
import { executorSignal } from '../executor.mjs';
import { deviceCommands } from './store-device.mjs';

/** The environment variable that may carry the passphrase (format 1 files). */
export const PASSPHRASE_ENV = 'HITLD_STORE_PASSPHRASE';
/** The environment variable that may carry age private keys (format 2 files). */
export const IDENTITY_ENV = 'HITLD_STORE_IDENTITY';

/** @type {import('../args.mjs').ArgSpec} */
const FILE = {
  name: 'file',
  type: 'string',
  positional: true,
  required: true,
  description: 'The export file',
};
/** @type {import('../args.mjs').ArgSpec} */
const PASSPHRASE_FD = {
  name: 'passphrase-fd',
  type: 'integer',
  mcp: false,
  description: `For a format-1 file: read the passphrase from this open file descriptor (0 for standard input), its first line. Default: $${PASSPHRASE_ENV}. Never on the command line`,
};
/** @type {import('../args.mjs').ArgSpec} */
const IDENTITY_FD = {
  name: 'identity-fd',
  type: 'integer',
  mcp: false,
  description: `For a format-2 file: read age private keys (AGE-SECRET-KEY-1..., one per line, # comments allowed, as age-keygen writes them) from this open file descriptor (0 for standard input). Default: $${IDENTITY_ENV}. Never on the command line`,
};
/** @type {import('../args.mjs').ArgSpec} */
const RECIPIENT = {
  name: 'recipient',
  type: 'string',
  repeatable: true,
  description:
    'An age public key (age1...) to encrypt the export to; once per recipient. The file opens with any of their private keys',
};
/** @type {import('../args.mjs').ArgSpec} */
const STORE = {
  name: 'store',
  type: 'string',
  description:
    "The private store directory. Default: the project's, from policy.json (project.id) under $XDG_DATA_HOME/human-in-the-lead",
};

class Refusal extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * A secret, from a file descriptor or the environment; never from an argument, which would land
 * in shell history and process lists.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 * @param {{ option: string, env: string, what: string, code: string }} from
 */
function secret(input, ctx, from) {
  const fd = input[from.option];
  /** @type {string | undefined} */
  let value;
  if (typeof fd === 'number') {
    if (!Number.isInteger(fd) || fd < 0) {
      throw new Refusal('usage', `--${from.option} must be 0 or more`);
    }
    try {
      value = readFileSync(fd, 'utf8');
    } catch (e) {
      throw new Refusal(
        from.code,
        `cannot read the ${from.what} from file descriptor ${fd}: ${/** @type {Error} */ (e).message}`,
      );
    }
  } else {
    value = ctx.env[from.env];
  }
  if (!value?.trim()) {
    throw new Refusal(
      from.code,
      `no ${from.what}: set ${from.env} or pass --${from.option} <n>; never on the command line`,
    );
  }
  return value;
}

/**
 * The passphrase for a format-1 file: the first line.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 */
const passphrase = (input, ctx) =>
  secret(input, ctx, {
    option: 'passphrase-fd',
    env: PASSPHRASE_ENV,
    what: 'passphrase',
    code: 'no-passphrase',
  }).split(/\r?\n/)[0];

/**
 * The age private keys for a format-2 file.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 */
async function identities(input, ctx) {
  const text = secret(input, ctx, {
    option: 'identity-fd',
    env: IDENTITY_ENV,
    what: 'age private key',
    code: 'no-identity',
  });
  const { parseIdentities } = await import('../../store/age.mjs');
  return parseIdentities(text);
}

/**
 * The key an existing file opens with, read only when it is needed: an age private key for
 * format 2, a passphrase for format 1. No file, no key.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 * @returns {Promise<import('../../store/sealed.mjs').Keys>}
 */
async function keysFor(input, ctx) {
  const file = resolve(String(input.file));
  if (!existsSync(file)) return {};
  const { formatOf } = await import('../../store/sealed.mjs');
  return formatOf(readFileSync(file)) === 2
    ? { identities: await identities(input, ctx) }
    : { passphrase: passphrase(input, ctx) };
}

/** @param {Record<string, unknown>} input */
const recipients = (input) => /** @type {string[]} */ (input.recipient ?? []);

/**
 * The project and its store.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 */
function project(input, ctx) {
  const loaded = loadPolicy({ cwd: ctx.cwd });
  if (!loaded.policy) {
    const why = loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ');
    throw new Refusal(
      'policy',
      `the store commands need the project's ID from a valid policy.json (${why})`,
    );
  }
  const projectId = loaded.policy.project.id;
  const root =
    typeof input.store === 'string'
      ? input.store
      : privateStorePath(projectId, {
          env: ctx.env,
          repoRoot: findRepoRoot(ctx.cwd) ?? undefined,
        });
  return { projectId, root };
}

/**
 * Refuse executors, then run; the store's own errors become a result with their code.
 * @param {string} name
 * @param {(input: Record<string, unknown>, ctx: import('../table.mjs').CommandContext) => Promise<import('../table.mjs').CommandResult> | import('../table.mjs').CommandResult} fn
 * @returns {NonNullable<import('../table.mjs').Command['run']>}
 */
const ownerOnly = (name, fn) => async (input, ctx) => {
  const why = executorSignal(ctx.env, ctx.cwd);
  if (why) {
    return {
      ok: false,
      error: 'not-permitted',
      message: `hitld ${name} is the owner's, run from the main session in the primary checkout (${why}); executors never move the private store`,
    };
  }
  try {
    return await fn(input, ctx);
  } catch (e) {
    const code = /** @type {{ code?: unknown }} */ (e).code;
    const known =
      e instanceof Refusal ||
      (e instanceof Error &&
        [
          'StoreGitError',
          'SealedError',
          'AgeError',
          'StoreRemoteError',
          'PushPullError',
          'DevicesError',
        ].includes(e.name));
    if (known && typeof code === 'string') {
      return { ok: false, error: code, message: /** @type {Error} */ (e).message };
    }
    throw e;
  }
};

/** Load the sync module only when a store command runs: it brings in node:sqlite. */
const sync = () => import('../../store/sync.mjs');

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'store export',
    summary:
      "Write the private store's text history to one file encrypted to age public keys: a git bundle and a manifest (owner only)",
    built_by: 'consumer-live',
    mcp: false,
    args: [FILE, RECIPIENT, STORE],
    run: ownerOnly('store export', async (input, ctx) => {
      const p = project(input, ctx);
      const { exportStore } = await sync();
      return {
        ok: true,
        ...exportStore({ ...p, recipients: recipients(input), file: String(input.file) }),
      };
    }),
  },
  {
    name: 'store import',
    summary:
      'Bring in an exported store (format 2 with an age private key, format 1 with a passphrase): verify it, refuse another project or a newer schema, merge append-only history (a conflict stops it), rebuild the index (owner only)',
    built_by: 'consumer-live',
    mcp: false,
    args: [FILE, IDENTITY_FD, PASSPHRASE_FD, STORE],
    run: ownerOnly('store import', async (input, ctx) => {
      const p = project(input, ctx);
      const file = resolve(String(input.file));
      if (!existsSync(file)) throw new Refusal('no-file', `there is no export file at ${file}`);
      const keys = await keysFor(input, ctx);
      const { importStore } = await sync();
      return importStore({ ...p, ...keys, file: String(input.file) });
    }),
  },
  {
    name: 'store sync',
    summary:
      'Both directions through one file: import it if it exists (either format), then export the merged store over it, encrypted to age public keys (owner only)',
    built_by: 'consumer-live',
    mcp: false,
    args: [FILE, RECIPIENT, IDENTITY_FD, PASSPHRASE_FD, STORE],
    run: ownerOnly('store sync', async (input, ctx) => {
      const p = project(input, ctx);
      // Refuse before any key is read or anything is imported.
      const { checkRecipients } = await import('../../store/sealed.mjs');
      checkRecipients(recipients(input));
      const keys = await keysFor(input, ctx);
      const { syncStore } = await sync();
      return syncStore({ ...p, ...keys, recipients: recipients(input), file: String(input.file) });
    }),
  },
  ...remoteCommands(),
  // store device init | list | remove (design 0003 section 6), in store-device.mjs.
  ...deviceCommands,
];

/**
 * Moving the store through its remote (design 0003, sections 7, 8 and 11). Owner only. Keys come
 * only through `resolveDevices`. The private key is read from the environment or a file
 * descriptor, never an argument, and no result or message carries it.
 */
function remoteCommands() {
  /** @type {import('../args.mjs').ArgSpec} */
  const URL_ARG = {
    name: 'url',
    type: 'string',
    positional: true,
    required: true,
    description:
      'The store repository: https://host/owner/repo.git, ssh://git@host/owner/repo.git, user@host:path or an absolute path. No password in it: sign in through git',
  };
  /**
   * The environment the resolver reads, with the key from --identity-fd put where it reads it.
   * There are no recipient flags: a push is encrypted to main's store-devices.json and nothing
   * else, so a removed device never gets a later push (design 0003 section 6).
   * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
   */
  function deviceEnv(input, ctx) {
    const env = { ...ctx.env };
    if (typeof input['identity-fd'] === 'number') {
      env[IDENTITY_ENV] = secret(input, ctx, {
        option: 'identity-fd',
        env: IDENTITY_ENV,
        what: 'age private key',
        code: 'no-identity',
      });
    }
    return env;
  }

  /**
   * The project and its store, and the remote address policy.json carries (store.remote.url).
   * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
   */
  function projectRemote(input, ctx) {
    const p = project(input, ctx);
    const loaded = loadPolicy({ cwd: ctx.cwd });
    /** @type {string | null} */
    const policyUrl = loaded.policy?.store?.remote?.url ?? null;
    return { ...p, policyUrl, loaded };
  }

  /**
   * The project, the push and pull module, and this device as main's list sees it. For a push,
   * main is fetched from origin first, and a device not on the list is refused.
   * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
   * @param {{ forPush?: boolean }} [o]
   */
  async function setUp(input, ctx, o = {}) {
    const p = projectRemote(input, ctx);
    const pp = await import('../../store/push-pull.mjs');
    const lookup = {
      checkout: findRepoRoot(ctx.cwd) ?? ctx.cwd,
      store: p.root,
      env: deviceEnv(input, ctx),
      projectId: p.projectId,
      mainBranch: p.loaded.policy?.merge?.main_branch ?? 'main',
    };
    const devices = o.forPush ? pp.devicesForPush(lookup) : pp.devicesHere(lookup);
    return { ...p, pp, devices };
  }

  /** @type {import('../table.mjs').Command[]} */
  return [
    {
      name: 'store push',
      summary:
        "Push the private store's text history to its remote, encrypted to the enrolled devices: a compare and swap on the remote's head; when the remote has moved, pull, merge and try again (owner only)",
      built_by: 'consumer-live',
      mcp: false,
      args: [IDENTITY_FD, STORE],
      run: ownerOnly('store push', async (input, ctx) => {
        const {
          projectId,
          root,
          policyUrl,
          pp,
          devices: d,
        } = await setUp(input, ctx, {
          forPush: true,
        });
        const { remote, url } = pp.openRemote(root, policyUrl);
        return pp.pushStore({ root, projectId, remote, url, devices: d, now: ctx.now });
      }),
    },
    {
      name: 'store pull',
      summary:
        "Fetch the remote's head, open it with this device's key and merge it into the private store as store import does; a conflict stops it with nothing merged (owner only)",
      built_by: 'consumer-live',
      mcp: false,
      args: [IDENTITY_FD, STORE],
      run: ownerOnly('store pull', async (input, ctx) => {
        const { projectId, root, policyUrl, pp, devices: d } = await setUp(input, ctx);
        const { remote, url } = pp.openRemote(root, policyUrl);
        return pp.pullStore({ root, projectId, remote, url, devices: d });
      }),
    },
    {
      name: 'store status',
      summary:
        "Report the remote and where its address came from, the local and remote versions, whether a push or a pull is due, and this device's enrolment; changes nothing in the store (owner only)",
      built_by: 'consumer-live',
      mcp: false,
      args: [STORE],
      run: ownerOnly('store status', async (input, ctx) => {
        const { projectId, root, policyUrl, pp, devices: d } = await setUp(input, ctx);
        const choice = pp.chooseRemote(root, policyUrl);
        const opened = choice ? pp.openRemote(root, policyUrl) : null;
        return pp.storeStatus({ root, projectId, opened, policyUrl, devices: d });
      }),
    },
    {
      name: 'store remote set',
      summary:
        "Set the remote's address. By default it is recorded for this machine only, as an override of policy.json's store.remote.url, and the policy.json change to commit is printed. With --policy it is written to policy.json, for the owner to review and commit (owner only)",
      built_by: 'consumer-live',
      mcp: false,
      args: [
        URL_ARG,
        {
          name: 'policy',
          type: 'boolean',
          description:
            "Write store.remote.url into policy.json (the project's address, which a fresh cloud container reads) instead of a machine override",
        },
        STORE,
      ],
      run: ownerOnly('store remote set', async (input, ctx) => {
        const p = projectRemote(input, ctx);
        const pp = await import('../../store/push-pull.mjs');
        const url = String(input.url);
        const { checkRemoteUrl } = await import('../../store/remote-git.mjs');
        checkRemoteUrl(url);
        const change = {
          file: p.loaded.path,
          set: 'store.remote.url',
          value: url,
          json: { store: { remote: { url } } },
        };
        if (input.policy) {
          if (!p.loaded.path || !p.loaded.raw) {
            throw new Refusal(
              'policy',
              'policy.json is missing or invalid; run hitld check policy',
            );
          }
          const raw = p.loaded.raw;
          const next = { ...raw, store: { ...raw.store, remote: { ...raw.store?.remote, url } } };
          // Trust boundary: the path is the policy.json loadPolicy found and read through trusted
          // loading; the content is that file with one key set.
          writeFileSync(p.loaded.path, JSON.stringify(next, null, 2) + '\n');
          const override = pp.readRemoteConfig(p.root);
          return {
            ok: true,
            project: p.projectId,
            written: 'policy',
            ...change,
            message: override
              ? `written; review the change to policy.json and commit it. This machine's override (${override.url}) still wins here: hitld store remote clear removes it`
              : 'written; review the change to policy.json and commit it',
          };
        }
        const set = pp.setRemote(p.root, url);
        return {
          ok: true,
          project: p.projectId,
          written: 'machine',
          ...set,
          policy_change: change,
          message:
            p.policyUrl === url
              ? 'recorded for this machine; policy.json already has this address'
              : 'recorded for this machine only. A fresh container reads policy.json: for it to find this remote, commit policy_change (or run again with --policy)',
        };
      }),
    },
    {
      name: 'store remote clear',
      summary:
        "Remove this machine's override of the remote's address, so policy.json's store.remote.url is used again (owner only)",
      built_by: 'consumer-live',
      mcp: false,
      args: [STORE],
      run: ownerOnly('store remote clear', async (input, ctx) => {
        const p = projectRemote(input, ctx);
        const { clearRemote } = await import('../../store/push-pull.mjs');
        return { ok: true, project: p.projectId, ...clearRemote(p.root) };
      }),
    },
    {
      name: 'store remote show',
      summary:
        "Show the remote's address and where it came from: this machine's override, else policy.json's store.remote.url (owner only)",
      built_by: 'consumer-live',
      mcp: false,
      args: [STORE],
      run: ownerOnly('store remote show', async (input, ctx) => {
        const p = projectRemote(input, ctx);
        const pp = await import('../../store/push-pull.mjs');
        return {
          ok: true,
          project: p.projectId,
          remote: pp.chooseRemote(p.root, p.policyUrl),
          policy_url: p.policyUrl,
          override_url: pp.readRemoteConfig(p.root)?.url ?? null,
        };
      }),
    },
  ];
}
