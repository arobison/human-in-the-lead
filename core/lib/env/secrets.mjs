// Secrets (design part 13.2): an agent never sees a value. A declared task (tasks.mjs) reads the
// values it is granted, gives them to one child process through its environment, and filters the
// child's output for them before anything is returned. The filter is defence in depth: what keeps
// a secret from an agent is that the agent cannot choose the command. Nothing here writes a value
// anywhere: not the registry, not the event log, not the result.

import { execFileSync, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { logEvent } from './registry.mjs';

/**
 * @typedef {(name: string) => string | null} SecretReader
 */

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const ENV_PREFIX = 'HITLD_SECRET_';

/**
 * A reader for the configured source of secret values.
 * @param {{ provider: 'auto' | 'keychain' | 'env', projectId: string, env: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform }} options
 * @returns {SecretReader}
 */
export function secretReader(options) {
  const service = `hitld-${options.projectId}`;
  const platform = options.platform ?? process.platform;
  /** @type {SecretReader} */
  const fromEnv = (name) => options.env[ENV_PREFIX + name] ?? null;
  /** @type {SecretReader} */
  const fromKeychain = (name) => {
    try {
      if (platform === 'darwin') {
        const out = execFileSync(
          'security',
          ['find-generic-password', '-s', service, '-a', name, '-w'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        );
        return out.replace(/\r?\n$/, '');
      }
      if (platform === 'linux') {
        return execFileSync('secret-tool', ['lookup', 'service', service, 'account', name], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      }
    } catch {
      // not found, or no keychain tool on this machine
    }
    return null;
  };
  if (options.provider === 'env') return fromEnv;
  if (options.provider === 'keychain') return fromKeychain;
  return (name) => fromKeychain(name) ?? fromEnv(name);
}

/**
 * Split a command line into words: spaces separate, single or double quotes group, a backslash
 * escapes the next character (outside single quotes). No expansion of any kind; the words are
 * passed to the program as they are, never to a shell.
 * @param {string} line @returns {string[]}
 */
export function splitCommand(line) {
  /** @type {string[]} */
  const words = [];
  let cur = '';
  let inWord = false;
  /** @type {'"' | "'" | null} */
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && i + 1 < line.length) cur += line[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (quote) throw new Error('the command has an unclosed quote');
  if (inWord) words.push(cur);
  return words;
}

/**
 * Finds secret values in text and replaces them with [REDACTED:NAME]. Besides the value itself it
 * recognises the forms a program commonly prints: JSON-escaped, URL-encoded, base64, base64url and
 * hex; and for a multi-line value, each line of at least six characters.
 * @param {Record<string, string>} secrets name to value
 */
export function createRedactor(secrets) {
  /** @type {{ text: string, name: string }[]} */
  const needles = [];
  /** @param {string} name @param {string} text */
  const add = (name, text) => {
    if (text.length > 0 && !needles.some((n) => n.text === text)) needles.push({ text, name });
  };
  for (const [name, value] of Object.entries(secrets)) {
    add(name, value);
    add(name, JSON.stringify(value).slice(1, -1));
    add(name, encodeURIComponent(value));
    const bytes = Buffer.from(value, 'utf8');
    add(name, bytes.toString('base64'));
    add(name, bytes.toString('base64').replace(/=+$/, ''));
    add(name, bytes.toString('base64url'));
    add(name, bytes.toString('hex'));
    if (value.includes('\n')) {
      for (const line of value.split(/\r?\n/)) if (line.trim().length >= 6) add(name, line.trim());
    }
  }
  needles.sort((a, b) => b.text.length - a.text.length);
  const longest = needles[0]?.text.length ?? 0;
  /** @type {Record<string, number>} */
  const counts = {};

  return {
    /** The longest string it looks for. */
    longest,
    /** How many replacements it has made, by secret name. */
    counts,
    /** @param {string} text @returns {string} */
    redact(text) {
      let out = text;
      for (const { text: needle, name } of needles) {
        if (!out.includes(needle)) continue;
        const parts = out.split(needle);
        counts[name] = (counts[name] ?? 0) + parts.length - 1;
        out = parts.join(`[REDACTED:${name}]`);
      }
      return out;
    },
    /**
     * Redact every string in JSON-like data, keys included.
     * @param {unknown} value @returns {any}
     */
    redactDeep(value) {
      if (typeof value === 'string') return this.redact(value);
      if (Array.isArray(value)) return value.map((v) => this.redactDeep(v));
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [this.redact(k), this.redactDeep(v)]),
        );
      }
      return value;
    },
  };
}

/**
 * An environment without the HITLD_SECRET_ variables, for any child that is not given secrets.
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function withoutSecrets(env) {
  /** @type {NodeJS.ProcessEnv} */
  const out = {};
  for (const [k, v] of Object.entries(env))
    if (!k.startsWith(ENV_PREFIX) && v !== undefined) out[k] = v;
  return out;
}

const CAPTURE_MAX = 4 * 1024 * 1024;
const REPORT_MAX = 64 * 1024;

/**
 * Run a program with secrets in its environment and return its filtered output. INTERNAL: this
 * runs whatever it is given, so only `execTask` (tasks.mjs), which takes the command from the
 * owner's policy.json after checking the dispatch's role, may call it.
 *
 * The child gets exactly `env` plus the secrets under their own names (any HITLD_SECRET_ variable
 * is dropped). Its output is captured, filtered, and cut to a size fit for a report; nothing it
 * prints reaches the caller unfiltered.
 * @param {{ store: import('./registry.mjs').PrivateStore, read: SecretReader }} ctx
 * @param {{ argv: string[], cwd: string, names: string[], env: NodeJS.ProcessEnv,
 *   timeoutMs?: number, audit?: Record<string, unknown> }} request
 */
export async function runWithSecrets(ctx, request) {
  const { argv, names } = request;
  const [file, ...args] = argv;
  if (!file) throw new Error('there is no command to run');
  for (const n of names) {
    if (!SECRET_NAME.test(n)) throw new Error(`"${n}" is not a secret name (A-Z, 0-9, _)`);
  }
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string[]} */
  const missing = [];
  for (const n of names) {
    const v = ctx.read(n);
    if (v === null || v === '') missing.push(n);
    else values[n] = v;
  }
  if (missing.length) {
    return {
      ok: false,
      error: 'secret-missing',
      message: `no value is stored for: ${missing.join(', ')}`,
      missing,
    };
  }
  const redactor = createRedactor(values);
  logEvent(ctx.store, 'secret_exec', { ...request.audit, names, command: file });

  const childEnv = { ...withoutSecrets(request.env), ...values };

  /** @param {Buffer[]} chunks */
  const finish = (chunks) => {
    const decoder = new StringDecoder('utf8');
    return chunks.map((c) => decoder.write(c)).join('') + decoder.end();
  };

  const run = await new Promise((resolveRun) => {
    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    const size = { out: 0, err: 0 };
    let truncated = false;
    let timedOut = false;
    /** @type {Error | null} */
    let spawnError = null;
    const child = spawn(file, args, {
      cwd: request.cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    /** @param {Buffer[]} into @param {'out' | 'err'} which @param {Buffer} d */
    const take = (into, which, d) => {
      if (size[which] >= CAPTURE_MAX) {
        truncated = true;
        return;
      }
      into.push(d);
      size[which] += d.length;
    };
    child.stdout.on('data', (d) => take(out, 'out', d));
    child.stderr.on('data', (d) => take(err, 'err', d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, request.timeoutMs ?? 600_000);
    child.on('error', (e) => {
      spawnError = e;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveRun({
        code,
        signal,
        out: finish(out),
        err: finish(err),
        truncated,
        timedOut,
        spawnError,
      });
    });
  });

  const r =
    /** @type {{ code: number | null, signal: string | null, out: string, err: string, truncated: boolean, timedOut: boolean, spawnError: Error | null }} */ (
      run
    );
  /**
   * Redact the whole capture, then cut, so a cut can never split a value in view. If the capture
   * itself ended early, first drop the last stretch a half-captured value could occupy.
   * @param {string} text
   */
  const report = (text) => {
    let cut = false;
    let base = text;
    if (r.truncated) {
      base = text.slice(0, Math.max(0, text.length - redactor.longest));
      cut = true;
    }
    let t = redactor.redact(base);
    if (t.length > REPORT_MAX) {
      t = t.slice(-REPORT_MAX);
      cut = true;
    }
    return { text: t, cut };
  };
  const stdout = report(r.out);
  const stderr = report(r.err);
  const result = {
    ok: r.code === 0 && !r.spawnError && !r.timedOut,
    exit_code: r.code,
    signal: r.signal,
    timed_out: r.timedOut,
    stdout: stdout.text,
    stderr: stderr.text,
    output_truncated: stdout.cut || stderr.cut,
    secrets_injected: names,
    redactions: { ...redactor.counts },
    ...(r.spawnError ? { error: 'spawn-failed', message: r.spawnError.message } : {}),
  };
  return redactor.redactDeep(result);
}
