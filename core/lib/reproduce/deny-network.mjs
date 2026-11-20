// Loaded with --import into every sandboxed test run of the reproducer (design part 2.2, step 3,
// and part 10.2). Best effort, not a boundary: the denial of network calls is done in-process, and
// a determined test may find a way to a raw handle this misses. An OS-level boundary (a network
// namespace, which runSandboxed uses where the machine allows one) is the real isolation for IP
// traffic; nothing here is an OS boundary for unix sockets.
//
// The run already has the permission model on (no child processes, no workers, no native addons,
// no inspector, no process.binding, reads only inside the sandbox). Before the test loads, this
// replaces: net (connect, createConnection, _createServerHandle, Socket#connect, Server#listen),
// tls.connect, dgram (createSocket, Socket and every method of a socket), every function of dns
// and dns.promises and every method of their Resolver classes, the fetch, WebSocket and
// EventSource globals, and the connect, bind, listen and open methods of the raw Pipe, TCP and UDP
// handle classes (reached from stdio and from handles made here first), so a handle pulled out of
// an object cannot be used to connect either. The ESM named exports are synced to the
// replacements. A refused call writes one marker line to stderr, which the runner counts, and
// throws.

import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

const MARKER = 'hitld-reproduce: network denied';

/** @param {string} what @returns {never} */
function deny(what) {
  try {
    process.stderr.write(`${MARKER}: ${what}\n`);
  } catch {
    // The marker is best effort; the refusal below is what matters.
  }
  const e = new Error(`the reproducer's sandbox refuses network calls (${what})`);
  Object.assign(e, { code: 'HITLD_NETWORK_DENIED' });
  throw e;
}

/** A refusal that also refuses `new`. @param {string} what */
const refusal = (what) =>
  function denied() {
    return deny(what);
  };

/** @param {object} target @param {string} name @param {string} what */
function replace(target, name, what) {
  Object.defineProperty(target, name, {
    value: refusal(what),
    writable: false,
    configurable: false,
    enumerable: true,
  });
}

/** Every function-valued own property of an object, except classes we patch by prototype. @param {any} target @param {string} label */
function replaceAll(target, label) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (name === 'Resolver' || name === 'promises' || name === 'constants') continue;
    const d = Object.getOwnPropertyDescriptor(target, name);
    if (d && d.configurable && typeof d.value === 'function') {
      replace(target, name, `${label}.${name}`);
    }
  }
}

/** Every method of a class's prototype. @param {any} cls @param {string} label */
function replaceMethods(cls, label) {
  if (typeof cls !== 'function') return;
  let proto = cls.prototype;
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(proto, name);
      // The two Resolver classes share a base: a method replaced already is left as it is.
      if (d && d.configurable && typeof d.value === 'function') {
        replace(proto, name, `${label}#${name}`);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
}

// The raw handle classes, taken before anything is replaced: stdio's Pipe, and a UDP and a TCP
// handle made here and closed at once (the TCP one is bound to a loopback port for a moment).
void process.stdout;
void process.stderr;
/** @type {any[]} */
const handleClasses = [];
const stdioHandle = /** @type {any} */ (process.stdout)._handle;
if (stdioHandle?.constructor) handleClasses.push(stdioHandle.constructor);
const udp = dgram.createSocket('udp4');
const state = Object.getOwnPropertySymbols(udp)
  .map((k) => /** @type {any} */ (udp)[k])
  .find((v) => v && typeof v === 'object' && v.handle);
if (state?.handle?.constructor) handleClasses.push(state.handle.constructor);
udp.close();
try {
  const tcp = /** @type {any} */ (net)._createServerHandle('127.0.0.1', 0, 4);
  if (tcp && typeof tcp === 'object') {
    handleClasses.push(tcp.constructor);
    tcp.close();
  }
} catch {
  // No TCP handle to learn the class from; net.Socket#connect is still refused below.
}
/** Methods of a raw handle that are not about the network. */
const KEEP = new Set([
  'constructor',
  'owner',
  'close',
  'ref',
  'unref',
  'hasRef',
  'getAsyncId',
  'getProviderType',
  'fchmod',
  'getsockname',
  'getpeername',
  'fd',
]);
for (const cls of handleClasses) {
  const proto = cls?.prototype;
  if (!proto) continue;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (KEEP.has(name)) continue;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (d && d.configurable && typeof d.value === 'function') {
      replace(proto, name, `${cls.name}#${name}`);
    }
  }
}

// Every TCP, TLS, HTTP(S), HTTP/2 and fetch client connects through net.Socket#connect.
replace(net.Socket.prototype, 'connect', 'socket connect');
replace(net, 'connect', 'net.connect');
replace(net, 'createConnection', 'net.createConnection');
replace(net, '_createServerHandle', 'net._createServerHandle');
replace(net.Server.prototype, 'listen', 'server listen');
replace(tls, 'connect', 'tls.connect');
// Its own methods only: the chain above it is EventEmitter's, which everything uses.
for (const name of Object.getOwnPropertyNames(dgram.Socket.prototype)) {
  const d = Object.getOwnPropertyDescriptor(dgram.Socket.prototype, name);
  if (name !== 'constructor' && d?.configurable && typeof d.value === 'function') {
    replace(dgram.Socket.prototype, name, `udp ${name}`);
  }
}
replace(dgram, 'createSocket', 'dgram.createSocket');
replace(dgram, 'Socket', 'dgram.Socket');
// The resolver classes are c-ares, which goes past net and dgram: every method is refused.
replaceMethods(dns.Resolver, 'dns.Resolver');
replaceMethods(dns.promises.Resolver, 'dns.promises.Resolver');
replaceAll(dns.promises, 'dns.promises');
replaceAll(dns, 'dns');
for (const name of ['fetch', 'WebSocket', 'EventSource']) {
  if (name in globalThis) replace(globalThis, name, name);
}
// The named exports of node:dns, node:net and the rest were bound when the builtins loaded.
syncBuiltinESMExports();
