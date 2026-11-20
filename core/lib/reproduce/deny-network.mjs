// Loaded with --import into every sandboxed test run of the reproducer (design part 2.2, step 3,
// and part 10.2). The run already has the permission model on (no child processes, no workers, no
// native addons, no inspector, no process.binding, reads only inside the sandbox), so the network
// calls below are what is left; each is replaced before the test loads, and the ESM named exports
// are synced to the replacements, so `import { lookup } from 'node:dns'` gets the refusal too.
// A refused call writes one marker line to stderr, which the runner counts, and throws.
//
// What is refused: net (connect, createConnection, Socket#connect, Server#listen), tls.connect,
// dgram sockets (send, connect, bind), every function of dns and dns.promises and every method of
// their Resolver classes, and the fetch, WebSocket and EventSource globals. HTTP, HTTPS and HTTP/2
// clients connect through net.Socket#connect. Node 22's permission model does not cover the
// network; where a Node has --allow-net, the runner turns that on as well (runner.mjs).

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
  const e = new Error(`the reproducer's sandbox has no network (${what})`);
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

// Every TCP, TLS, HTTP(S), HTTP/2 and fetch client connects through net.Socket#connect.
replace(net.Socket.prototype, 'connect', 'socket connect');
replace(net, 'connect', 'net.connect');
replace(net, 'createConnection', 'net.createConnection');
replace(net.Server.prototype, 'listen', 'server listen');
replace(tls, 'connect', 'tls.connect');
for (const name of ['send', 'connect', 'bind']) {
  replace(dgram.Socket.prototype, name, `udp ${name}`);
}
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
