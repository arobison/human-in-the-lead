// Moving and syncing the private store between machines (design part 3.2, Q1). Owner only.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { privateStorePath } from '../../store/store.mjs';
import { executorSignal } from '../executor.mjs';

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
    code: 'no_passphrase',
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
      'no_policy',
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
      error: 'not_permitted',
      message: `hitld ${name} is the owner's, run from the main session in the primary checkout (${why}); executors never move the private store`,
    };
  }
  try {
    return await fn(input, ctx);
  } catch (e) {
    const code = /** @type {{ code?: unknown }} */ (e).code;
    const known =
      e instanceof Refusal ||
      (e instanceof Error && ['StoreGitError', 'SealedError', 'AgeError'].includes(e.name));
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
];
