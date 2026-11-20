// Loaded with --import into every sandboxed test run of the reproducer (design part 2.2, step 3,
// and part 10.2). The run already has the permission model on (no child processes, no workers, no
// native addons, no process.binding, reads only inside the sandbox), so the network calls below
// are the only way out; each is replaced before the test loads. A refused call writes one marker
// line to stderr, which the runner counts, and throws.
//
// Node 22's permission model does not cover the network, which is why this exists. A harness
// adapter's own sandbox (part 10.2, Sandboxing) is the outer line where one exists.

import dgram from 'node:dgram';
import dns from 'node:dns';
import net from 'node:net';

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

/** @param {object} target @param {string} name @param {string} what */
function replace(target, name, what) {
  Object.defineProperty(target, name, {
    value: () => deny(what),
    writable: false,
    configurable: false,
  });
}

// Every TCP, TLS, HTTP(S), HTTP/2 and fetch client connects through net.Socket#connect.
replace(net.Socket.prototype, 'connect', 'socket connect');
replace(net, 'connect', 'net.connect');
replace(net, 'createConnection', 'net.createConnection');
replace(net.Server.prototype, 'listen', 'server listen');
for (const name of ['send', 'connect', 'bind'])
  replace(dgram.Socket.prototype, name, `udp ${name}`);
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  replace(dns, name, `dns ${name}`);
  replace(dns.promises, name, `dns ${name}`);
}
for (const name of ['fetch', 'WebSocket', 'EventSource']) {
  if (name in globalThis) replace(globalThis, name, name);
}
