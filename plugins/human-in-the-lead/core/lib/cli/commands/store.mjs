// Moving and syncing the private store between machines (design part 3.2, Q1). Owner only.

import { readFileSync } from 'node:fs';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { privateStorePath } from '../../store/store.mjs';
import { executorSignal } from '../executor.mjs';

/** The environment variable that may carry the passphrase. */
export const PASSPHRASE_ENV = 'HITLD_STORE_PASSPHRASE';

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
  description: `Read the passphrase from this open file descriptor (0 for standard input), its first line. Default: $${PASSPHRASE_ENV}. Never on the command line`,
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
 * The passphrase, from a file descriptor or the environment; never from an argument, which would
 * land in shell history and process lists.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 */
function passphrase(input, ctx) {
  const fd = input['passphrase-fd'];
  /** @type {string | undefined} */
  let value;
  if (typeof fd === 'number') {
    if (!Number.isInteger(fd) || fd < 0)
      throw new Refusal('usage', '--passphrase-fd must be 0 or more');
    try {
      value = readFileSync(fd, 'utf8').split(/\r?\n/)[0];
    } catch (e) {
      throw new Refusal(
        'no-passphrase',
        `cannot read the passphrase from file descriptor ${fd}: ${/** @type {Error} */ (e).message}`,
      );
    }
  } else {
    value = ctx.env[PASSPHRASE_ENV];
  }
  if (!value) {
    throw new Refusal(
      'no-passphrase',
      `no passphrase: set ${PASSPHRASE_ENV} or pass --passphrase-fd <n>; never on the command line`,
    );
  }
  return value;
}

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
      (e instanceof Error && ['StoreGitError', 'SealedError'].includes(e.name));
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
      "Write the private store's text history to one encrypted file: a git bundle and a manifest (owner only)",
    built_by: 'consumer-live',
    mcp: false,
    args: [FILE, PASSPHRASE_FD, STORE],
    run: ownerOnly('store export', async (input, ctx) => {
      const p = project(input, ctx);
      const secret = passphrase(input, ctx);
      const { exportStore } = await sync();
      return {
        ok: true,
        ...exportStore({ ...p, passphrase: secret, file: String(input.file) }),
      };
    }),
  },
  {
    name: 'store import',
    summary:
      'Bring in an exported store: verify it, refuse another project or a newer schema, merge append-only history (a conflict stops it), rebuild the index (owner only)',
    built_by: 'consumer-live',
    mcp: false,
    args: [FILE, PASSPHRASE_FD, STORE],
    run: ownerOnly('store import', async (input, ctx) => {
      const p = project(input, ctx);
      const secret = passphrase(input, ctx);
      const { importStore } = await sync();
      return importStore({ ...p, passphrase: secret, file: String(input.file) });
    }),
  },
  {
    name: 'store sync',
    summary:
      'Both directions through one file: import it if it exists, then export the merged store over it (owner only)',
    built_by: 'consumer-live',
    mcp: false,
    args: [FILE, PASSPHRASE_FD, STORE],
    run: ownerOnly('store sync', async (input, ctx) => {
      const p = project(input, ctx);
      const secret = passphrase(input, ctx);
      const { syncStore } = await sync();
      return syncStore({ ...p, passphrase: secret, file: String(input.file) });
    }),
  },
];
