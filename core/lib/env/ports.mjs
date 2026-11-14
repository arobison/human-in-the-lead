// Dev-server port leases (design part 13.2). A port is leased only if it is free both in the
// registry and on the operating system (a test bind), so the owner's own servers are never
// disturbed. The manager stops a server only when the process matches what it recorded when it
// started it: same ID, same start time, same working directory.

import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { checkHolder } from './config.mjs';
import { logEvent, updateRegistry } from './registry.mjs';
import { isAlive, matchProcess, processInfo, sleep } from './proc.mjs';

/**
 * @typedef {import('./registry.mjs').PortLease} PortLease
 * @typedef {import('./registry.mjs').PrivateStore} PrivateStore
 */

/**
 * Try to bind a port on one address. EADDRINUSE and EACCES mean someone else has it; an address
 * family the machine lacks is not a conflict.
 * @param {number} port @param {string} host
 * @returns {Promise<boolean>} true if the port is free there
 */
function canBind(port, host) {
  return new Promise((resolveBind) => {
    const server = createServer();
    server.unref();
    server.once('error', (e) => {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code;
      resolveBind(code !== 'EADDRINUSE' && code !== 'EACCES');
    });
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolveBind(true)));
  });
}

/**
 * Whether nothing on this machine is using a port, on any address a dev server might use.
 * @param {number} port
 */
export async function portIsFree(port) {
  for (const host of ['0.0.0.0', '127.0.0.1', '::', '::1']) {
    if (!(await canBind(port, host))) return false;
  }
  return true;
}

/**
 * Reap registry entries whose server process is gone. An entry whose process is alive stays, even
 * if it is not the process we recorded: the port is then in use by someone else, and is skipped.
 * @param {import('./registry.mjs').Registry} registry
 * @returns {number[]} the ports reaped
 */
function reap(registry) {
  /** @type {number[]} */
  const reaped = [];
  for (const [key, lease] of Object.entries(registry.ports)) {
    if (lease.server && matchProcess(lease.server) === 'gone') {
      delete registry.ports[key];
      reaped.push(lease.port);
    }
  }
  return reaped;
}

/**
 * Lease a free port in the range to a holder. The holder gets the same port again if it asks twice.
 * @param {{ store: PrivateStore, range: { min: number, max: number } }} ctx
 * @param {{ holder: string }} request
 * @returns {Promise<{ lease: PortLease, existing: boolean, skipped: number[] }>}
 *   skipped: ports in the range that something else was using
 */
export async function leasePort(ctx, request) {
  const holder = checkHolder(request.holder);
  const { min, max } = ctx.range;
  if (min > max) throw new Error(`port_range is empty (${min} to ${max})`);
  return updateRegistry(ctx.store, async (registry) => {
    reap(registry);
    const have = Object.values(registry.ports).find((p) => p.holder === holder);
    if (have) return { lease: have, existing: true, skipped: [] };
    /** @type {number[]} */
    const skipped = [];
    for (let port = min; port <= max; port++) {
      if (registry.ports[String(port)]) continue;
      if (!(await portIsFree(port))) {
        skipped.push(port);
        continue;
      }
      /** @type {PortLease} */
      const lease = { port, holder, leased_at: new Date().toISOString(), server: null };
      registry.ports[String(port)] = lease;
      logEvent(ctx.store, 'port_leased', { holder, port, skipped });
      return { lease, existing: false, skipped };
    }
    throw new Error(
      `no free port in ${min} to ${max} (${skipped.length} in use by other processes)`,
    );
  });
}

/**
 * Start a dev server on a holder's leased port and record the process, so it alone can be stopped
 * later. The port goes to the server as PORT. The server runs detached, with output to a log under
 * the store.
 * @param {{ store: PrivateStore }} ctx
 * @param {{ holder: string, argv: string[], cwd: string, env?: NodeJS.ProcessEnv }} request
 * @returns {Promise<PortLease>}
 */
export async function startServer(ctx, request) {
  const holder = checkHolder(request.holder);
  const cwd = realpathSync(resolve(request.cwd));
  const [file, ...args] = request.argv;
  if (!file) throw new Error('startServer needs a command');
  const lease = await updateRegistry(ctx.store, (registry) => {
    const l = Object.values(registry.ports).find((p) => p.holder === holder);
    if (!l) throw new Error(`${holder} has no leased port; lease one first`);
    if (l.server && matchProcess(l.server) !== 'gone') {
      throw new Error(`${holder}'s port ${l.port} already has a server (pid ${l.server.pid})`);
    }
    return l;
  });
  const logDir = join(ctx.store.root, 'env', 'logs');
  mkdirSync(logDir, { recursive: true });
  const logFd = openSync(join(logDir, `${holder}-${lease.port}.log`), 'a');
  let child;
  try {
    child = spawn(file, args, {
      cwd,
      env: { ...(request.env ?? process.env), PORT: String(lease.port) },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }
  child.unref();
  const pid = child.pid;
  if (!pid) {
    await new Promise((r) => child.once('error', r));
    throw new Error(`could not start ${file}`);
  }
  // The identity must be read from the running process, so wait for it to exist.
  let info = processInfo(pid);
  for (let i = 0; i < 50 && !info?.cwd; i++) {
    await sleep(20);
    info = processInfo(pid);
  }
  if (!info?.cwd) throw new Error(`could not read the identity of the server process ${pid}`);
  return updateRegistry(ctx.store, (registry) => {
    const l = registry.ports[String(lease.port)];
    l.server = {
      pid,
      start: info.start,
      cwd: /** @type {string} */ (info.cwd),
      command: request.argv.join(' '),
      started_at: new Date().toISOString(),
    };
    logEvent(ctx.store, 'server_started', { holder, port: l.port, pid });
    return l;
  });
}

/**
 * Release a holder's port lease. A server the manager started is stopped only if the process still
 * matches what was recorded; a process that does not match is left alone (and the lease is
 * dropped, the port no longer being the manager's to hand out until the OS says it is free).
 * @param {{ store: PrivateStore }} ctx
 * @param {{ holder: string, graceMs?: number }} request
 * @returns {Promise<{ released: boolean, port?: number, stopped: boolean, left_alone?: string }>}
 */
export async function releasePort(ctx, request) {
  const holder = checkHolder(request.holder);
  const grace = request.graceMs ?? 3000;
  return updateRegistry(ctx.store, async (registry) => {
    const lease = Object.values(registry.ports).find((p) => p.holder === holder);
    if (!lease) return { released: false, stopped: false };
    let stopped = false;
    /** @type {string | undefined} */
    let leftAlone;
    if (lease.server) {
      const verdict = matchProcess(lease.server);
      if (verdict === 'match') {
        stopped = await stopOwn(lease.server.pid, lease.server, grace);
        if (!stopped) leftAlone = 'the server did not exit when asked';
      } else if (verdict === 'other') {
        leftAlone = `pid ${lease.server.pid} is alive but is not the server the manager started`;
      }
    }
    delete registry.ports[String(lease.port)];
    logEvent(ctx.store, 'port_released', {
      holder,
      port: lease.port,
      stopped,
      ...(leftAlone ? { left_alone: leftAlone } : {}),
    });
    return {
      released: true,
      port: lease.port,
      stopped,
      ...(leftAlone ? { left_alone: leftAlone } : {}),
    };
  });
}

/**
 * Stop a process the manager started: ask, wait, and only if it is still the same process, force.
 * @param {number} pid @param {import('./registry.mjs').ServerRecord} recorded @param {number} graceMs
 */
async function stopOwn(pid, recorded, graceMs) {
  /** @param {NodeJS.Signals} sig */
  const signal = (sig) => {
    try {
      // The server runs detached as its own group leader; stop its group so its children go too.
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        // already gone
      }
    }
  };
  signal('SIGTERM');
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid) || matchProcess(recorded) !== 'match') return true;
    await sleep(50);
  }
  if (matchProcess(recorded) === 'match') signal('SIGKILL');
  await sleep(100);
  return matchProcess(recorded) !== 'match';
}
