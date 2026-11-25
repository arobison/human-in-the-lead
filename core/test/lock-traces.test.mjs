// The review's lock failures (HITLD-1051), replayed through the real file-system shell: real lock
// files, a real process behind each holder, the clock mocked. Each trace is the one the model runs
// in lockcore.test.mjs, and both must give the expected results, so the model cannot pass while
// the code fails. They use only acquireLock, releaseLock and lockStatus, and so also run against
// locks.mjs from before this change, where they fail.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs, { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireLock, lockStatus, releaseLock } from '../lib/env/locks.mjs';
import { TRACES, expected, runTraceInModel } from './helpers/lock-model.mjs';
import { tempDir } from './helpers/tmp.mjs';

const LOCKS_MJS = fileURLToPath(new URL('../lib/env/locks.mjs', import.meta.url));

/** @type {Set<import('node:child_process').ChildProcess>} */
const children = new Set();
after(() => {
  for (const c of children) c.kill('SIGKILL');
});

/** @param {string} code @returns {Promise<import('node:child_process').ChildProcess>} */
async function child(code) {
  const c = spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.add(c);
  await new Promise((resolve, reject) => {
    c.stdout?.once('data', resolve);
    c.once('error', reject);
  });
  return c;
}

/** A process that only lives, for a holder's lock to follow. */
const sleeper = () => child(`console.log('up'); setInterval(() => {}, 1000);`);

/** @param {import('node:child_process').ChildProcess} c */
async function kill(c) {
  if (c.exitCode !== null || c.signalCode !== null) return;
  c.kill('SIGKILL');
  await new Promise((r) => c.once('exit', r));
}

/** @param {number} ms */
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait without giving up the thread (inside a synchronous file read). @param {number} ms */
const block = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * An outcome's name, as the model names it.
 * @param {Awaited<ReturnType<typeof acquireLock>>} r @param {string} name
 */
function resultOf(r, name) {
  if (r.acquired) return r.renewed ? 'renewed' : 'granted';
  if (r.timed_out) return 'timed out';
  return r.held_by?.holder === name ? 'conflict' : 'refused';
}

/**
 * The steps marked `during` run in another process while the waiter's first ask is deciding: the
 * holder is released by name and a newcomer asks for itself. The process waits for a signal file,
 * runs them and writes their results.
 * @param {string} machineRoot @param {string} dir
 * @param {import('./helpers/lock-model.mjs').TraceStep[]} steps
 * @param {import('./helpers/lock-model.mjs').ActorSpec[]} actors
 */
const duringChild = (machineRoot, dir, steps, actors) => `
  import { acquireLock, releaseLock } from ${JSON.stringify(pathToFileURL(LOCKS_MJS).href)};
  import { existsSync, writeFileSync } from 'node:fs';
  const ctx = { machineRoot: ${JSON.stringify(machineRoot)} };
  const steps = ${JSON.stringify(steps)};
  const actors = ${JSON.stringify(actors)};
  console.log('up');
  while (!existsSync(${JSON.stringify(join(dir, 'go'))})) await new Promise((r) => setTimeout(r, 2));
  const results = [];
  for (const s of steps) {
    const a = actors.find((x) => x.id === s.actor);
    if (s.do === 'releaseByName') {
      results.push(releaseLock(ctx, { resource: s.r, holder: a.name }).released ? 'released' : 'kept');
    } else {
      const r = await acquireLock(ctx, { resource: s.r, holder: a.name, pid: process.pid, autoRenew: false });
      results.push(r.acquired ? (r.renewed ? 'renewed' : 'granted') : r.held_by?.holder === a.name ? 'conflict' : 'refused');
    }
  }
  writeFileSync(${JSON.stringify(join(dir, 'done'))}, JSON.stringify(results));
  setInterval(() => {}, 1000);`;

/**
 * Run a trace through the file-system shell.
 * @param {import('./helpers/lock-model.mjs').Trace} t @param {import('node:test').TestContext} tc
 * @returns {Promise<{ results: string[], holder: string | null }>}
 */
async function runTraceOnDisk(t, tc) {
  const machineRoot = tempDir('hitld-lock-trace-');
  const ctx = { machineRoot };
  const lockPath = join(machineRoot, 'locks', 'gpu.lock');
  const during = t.steps.filter((s) => s.during);
  /** @type {Map<string, import('node:child_process').ChildProcess>} */
  const procs = new Map();
  for (const a of t.actors) {
    if (during.some((s) => s.do === 'ask' && s.actor === a.id)) continue;
    procs.set(a.id, await sleeper());
  }
  const signals = tempDir('hitld-lock-trace-signal-');
  if (during.length) {
    procs.set(
      /** @type {string} */ (during.find((s) => s.do === 'ask')?.actor),
      await child(duringChild(machineRoot, signals, during, t.actors)),
    );
  }
  tc.mock.timers.enable({ apis: ['Date'], now: Date.now() });

  /** @type {Map<string, { handle: import('../lib/env/locks.mjs').LockHandle }>} */
  const handles = new Map();
  /** @type {Map<string, { done: boolean, value?: Awaited<ReturnType<typeof acquireLock>> }>} */
  const pending = new Map();
  /** @type {Promise<unknown>[]} */
  const promises = [];
  /** @type {string[]} */
  const results = [];
  const actor = (/** @type {string} */ id) =>
    /** @type {import('./helpers/lock-model.mjs').ActorSpec} */ (t.actors.find((a) => a.id === id));
  const pidOf = (/** @type {string} */ id) => /** @type {number} */ (procs.get(id)?.pid);
  /** @param {string} id @param {Awaited<ReturnType<typeof acquireLock>>} r */
  const record = (id, r) => {
    if (r.acquired) handles.set(id, { handle: r.handle });
    return resultOf(r, actor(id).name);
  };
  /** Wait for a pending ask to end, up to `ms`; null while it still waits. @param {string} id @param {number} ms */
  const settle = async (id, ms) => {
    const p = pending.get(id);
    for (let i = 0; p && !p.done && i < ms / 10; i++) await realSleep(10);
    if (!p?.done) return null;
    pending.delete(id);
    return record(id, /** @type {Awaited<ReturnType<typeof acquireLock>>} */ (p.value));
  };

  for (const s of t.steps) {
    if (s.during) continue;
    /** @type {string | null} */
    let result = null;
    if (s.do === 'clock') tc.mock.timers.setTime(Date.now() + s.ms);
    else if (s.do === 'halfWritten') {
      mkdirSync(join(machineRoot, 'locks'), { recursive: true });
      writeFileSync(lockPath, '');
    } else if (s.do === 'crash') await kill(/** @type {any} */ (procs.get(s.actor)));
    else if (s.do === 'ask') {
      const a = actor(s.actor);
      const request = {
        resource: s.r,
        holder: a.name,
        pid: pidOf(a.id),
        ttlSeconds: t.ttlMs / 1000,
        autoRenew: false,
        wait: s.wait === true,
        pollMs: 10,
        timeoutMs: 15_000,
      };
      if (!request.wait) result = record(a.id, await acquireLock(ctx, request));
      else {
        const hook = during.length ? armHook(lockPath, signals) : null;
        /** @type {{ done: boolean, value?: Awaited<ReturnType<typeof acquireLock>> }} */
        const p = { done: false };
        pending.set(a.id, p);
        promises.push(
          acquireLock(ctx, request).then((v) => {
            p.done = true;
            p.value = v;
          }),
        );
        // It ends, or it is seen waiting.
        for (let i = 0; i < 200 && !p.done; i++) {
          if (!hook?.armed() && lockStatus(ctx, ['gpu'])[0].waiting.includes(a.name)) break;
          await realSleep(10);
        }
        hook?.disarm();
        result = (await settle(a.id, 0)) ?? 'queued';
        if (hook) {
          for (let i = 0; i < 1000 && !existsSync(join(signals, 'done')); i++) await realSleep(10);
          results.push(result, ...JSON.parse(readFileSync(join(signals, 'done'), 'utf8')));
          continue;
        }
      }
    } else if (s.do === 'poll') result = (await settle(s.actor, 1000)) ?? 'queued';
    else if (s.do === 'release') {
      const h = handles.get(s.actor);
      handles.delete(s.actor);
      result = h?.handle.release() ? 'released' : 'kept';
    } else if (s.do === 'releaseByName') {
      result = releaseLock(ctx, { resource: s.r, holder: actor(s.actor).name }).released
        ? 'released'
        : 'kept';
    } else throw new Error(`no file-system step for ${s.do}`);
    if (s.expect !== undefined) results.push(/** @type {string} */ (result));
  }

  const held = lockStatus(ctx, ['gpu'])[0];
  const holderPid = held.stale ? null : held.record?.pid;
  const holder = [...procs].find(([, c]) => c.pid === holderPid)?.[0] ?? null;

  // Let every waiter end: the holders' processes go, so their locks are stale and the waiters
  // take them; with the real clock back, one that cannot gives up at its timeout.
  tc.mock.timers.reset();
  for (const c of procs.values()) await kill(c);
  for (const [id, h] of handles) {
    h.handle.release();
    handles.delete(id);
  }
  await Promise.all(
    promises.map((p) =>
      p.then(() => {
        for (const h of handles.values()) h.handle.release();
      }),
    ),
  );
  for (const [id] of pending) await settle(id, 0);
  for (const h of handles.values()) h.handle.release();
  return { results, holder };
}

/**
 * Hold the next read of the lock file in this process (the waiter's first look at the lock) while
 * the other process runs the `during` steps: start it, and give it up to two seconds to finish. A
 * shell that decides inside a critical section keeps it out until the waiter's decision is made;
 * one that does not lets it in ahead of the waiter.
 * @param {string} lockPath @param {string} signals
 */
function armHook(lockPath, signals) {
  const original = fs.readFileSync;
  let armed = true;
  const disarm = () => {
    if (fs.readFileSync === hooked) {
      fs.readFileSync = original;
      syncBuiltinESMExports();
    }
  };
  /** @type {typeof fs.readFileSync} */
  const hooked = /** @type {any} */ (
    function (/** @type {any} */ path, /** @type {any[]} */ ...rest) {
      if (armed && String(path) === lockPath) {
        armed = false;
        writeFileSync(join(signals, 'go'), '');
        for (let i = 0; i < 400 && !existsSync(join(signals, 'done')); i++) block(5);
      }
      return /** @type {any} */ (original).call(fs, path, ...rest);
    }
  );
  fs.readFileSync = hooked;
  syncBuiltinESMExports();
  return { armed: () => armed, disarm };
}

for (const t of TRACES) {
  test(`trace on disk: ${t.name}`, async (tc) => {
    const want = expected(t);
    const model = runTraceInModel(t);
    const disk = await runTraceOnDisk(t, tc);
    assert.deepEqual(disk.results, want, 'the file-system shell');
    assert.deepEqual(disk.results, model.results, 'the shell and the model agree');
    assert.equal(disk.holder, t.holder ?? null, 'who holds it at the end');
    assert.equal(disk.holder, model.holder);
  });
}
