#!/usr/bin/env node
// SessionStart pulls the private store from its remote, SessionEnd pushes it (design 0003,
// section 8): the backstop for a session that dies between two checkpoints. The run commands do
// the same at their own clean points; this runs for every session, so it does nothing for an
// executor and nothing for a project with no remote or a device with no key.
//
// Usage: store-sync.mjs pull | push
//
// It prints one line about what it did and always exits 0: a network failure is reported, never a
// reason to stop the session. The harness's own hook timeout bounds a connection that hangs.

import { isExecutor, readHookInput } from './input.mjs';

const action = process.argv[2];
const input = readHookInput();
if ((action === 'pull' || action === 'push') && !isExecutor(input, process.env)) {
  try {
    const { hookSync } = await import('../../../lib/store/auto-sync.mjs');
    const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
    const line = await hookSync(action, { cwd, env: process.env });
    if (line) process.stdout.write(`${line}\n`);
  } catch (e) {
    process.stdout.write(`store ${action} failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
process.exit(0);
