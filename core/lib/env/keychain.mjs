// The operating system's keychain (design part 13.2): `security` on macOS, `secret-tool` (the
// Secret Service, through libsecret) on Linux. Secrets for declared tasks are read through it
// (secrets.mjs), and so is a store device's private key (design 0003 section 9), which is the one
// value hitld writes to it.
//
// A value never goes on a command line, where a process list would show it: `secret-tool store`
// reads it from standard input, and `security` takes the whole command from standard input in its
// interactive mode. Nothing here logs or returns a value it wrote.

import { execFileSync } from 'node:child_process';

/** A service, account or value the tools take as one word, unquoted. */
const WORD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * @typedef {object} Keychain
 * @property {'security' | 'secret-tool' | null} tool the program this platform's keychain is
 *   reached with, or null where there is none
 * @property {(account: string) => string | null} read the value stored under an account, or
 *   null: not found, or no keychain here
 * @property {(account: string, value: string, label: string) => { ok: true } | { ok: false, reason: string }} write
 *   store a value under an account, never replacing one already there; the reason on failure is
 *   the tool's own first line, with the value cut out
 */

/**
 * The keychain, for one service.
 * @param {{ service: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number }} options
 *   env is the environment the tool runs in (its PATH); the default is this process's. timeoutMs:
 *   how long a tool may take before it counts as failed (a read is then not found); none by
 *   default, so a keychain that asks the person to unlock it waits for them
 * @returns {Keychain}
 */
export function keychain(options) {
  const platform = options.platform ?? process.platform;
  const { service } = options;
  /** @type {Keychain['tool']} */
  const tool = platform === 'darwin' ? 'security' : platform === 'linux' ? 'secret-tool' : null;
  /** @param {string} program @param {string[]} args @param {string} [input] */
  const run = (program, args, input) =>
    execFileSync(program, args, {
      encoding: 'utf8',
      env: options.env,
      input,
      ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
  /** @type {Keychain['read']} */
  const read = (account) => {
    try {
      if (tool === 'security') {
        const out = run(tool, ['find-generic-password', '-s', service, '-a', account, '-w']);
        return out.replace(/\r?\n$/, '');
      }
      if (tool === 'secret-tool') {
        return run(tool, ['lookup', 'service', service, 'account', account]);
      }
    } catch {
      // not found, or no keychain tool on this machine
    }
    return null;
  };
  return {
    tool,
    read,
    write(account, value, label) {
      if (!tool)
        return { ok: false, reason: `there is no keychain hitld can reach on ${platform}` };
      if (![service, account, value].every((w) => WORD.test(w))) {
        return {
          ok: false,
          reason: 'the service, account or value has characters the keychain tools would split',
        };
      }
      if (read(account) !== null) {
        return { ok: false, reason: `a value is already stored for ${service} ${account}` };
      }
      const safeLabel = label.replace(/[^A-Za-z0-9 ._-]/g, '');
      try {
        if (tool === 'security') {
          run(
            tool,
            ['-i'],
            `add-generic-password -s ${service} -a ${account} -l "${safeLabel}" -w ${value}\n`,
          );
        } else {
          run(
            tool,
            ['store', `--label=${safeLabel}`, 'service', service, 'account', account],
            value,
          );
        }
      } catch (e) {
        const err = /** @type {{ stderr?: unknown, message?: unknown }} */ (e);
        const text = String(err.stderr || err.message || 'failed');
        const first = text.split(value).join('[REDACTED]').trim().split('\n')[0];
        return { ok: false, reason: first || `${tool} failed` };
      }
      // `security -i` exits 0 even when its command fails, so the value counts as stored only
      // once it reads back.
      return read(account) === value
        ? { ok: true }
        : { ok: false, reason: `${tool} did not keep the value` };
    },
  };
}
