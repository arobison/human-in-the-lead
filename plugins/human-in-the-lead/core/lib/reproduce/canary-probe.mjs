// The canary for the reproducer's sandbox (reproduce.mjs, checkSandboxHolds): copied into a
// canary directory as test/canary.test.mjs and run like any reproduction, before any result is
// trusted. Fixed text: what it needs to know comes from test/canary.json beside it, never from
// source built at run time. Every test passes only when the limit it probes holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns';
import net from 'node:net';
import dgram from 'node:dgram';

/** @type {{ outside: string, node: string, socket: string }} */
const config = JSON.parse(readFileSync(new URL('./canary.json', import.meta.url), 'utf8'));
const denied = { code: 'HITLD_NETWORK_DENIED' };
const noAccess = { code: 'ERR_ACCESS_DENIED' };

test('read outside', () => assert.throws(() => readFileSync(config.outside), noAccess));
test('socket', () => assert.throws(() => net.connect(9, '127.0.0.1'), denied));
test('dns', () => assert.throws(() => lookup('localhost', () => {}), denied));
test('process', () => assert.throws(() => execFileSync(config.node, ['-v']), noAccess));
test('udp', () => assert.throws(() => dgram.createSocket('udp4'), denied));
// A raw Pipe handle, made from stdio's handle class, connecting to a unix socket path.
test('raw pipe', () => {
  const Pipe = /** @type {any} */ (process.stdout)._handle.constructor;
  assert.throws(() => new Pipe(0).connect({}, config.socket), denied);
});
