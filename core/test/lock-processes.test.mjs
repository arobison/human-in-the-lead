// The machine locks across real processes (HITLD-1052). Each test runs its holders and waiters as
// separate node processes and orders them with barrier files, not sleeps: a process writes a file
// when it reaches a point, and waits for a file before it goes on. They check what HITLD-1052
// promises: a holder that asks again renews at once while others queue; two processes under one
// name are refused; a holder killed outright lets the next waiter in within the poll limit; a
// stale handle's release leaves the new holder in place; a live holder blocked past its expiry
// keeps the lock; many processes on a capacity of 4 never hold more than 4, read from an
// append-only log; records and tickets an older copy wrote are respected; a ticket whose pid was
// reused does not hold the line; a waiter's signal or abort takes its ticket with it; and the
// start-time probe is cached.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  acquireLock,
  lockStatus,
  outdatedCopies,
  probes,
  processIdentity,
  releaseLock,
} from '../lib/env/locks.mjs';
import { processStart } from '../lib/env/proc.mjs';
import { tempDir } from './helpers/tmp.mjs';

const LOCKS = pathToFileURL(fileURLToPath(new URL('../lib/env/locks.mjs', import.meta.url))).href;

/** @type {Set<import('node:child_process').ChildProcess>} */
const children = new Set();
after(() => {
  for (const c of children) c.kill('SIGKILL');
});

/** @param {number} ms */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a barrier file, or a condition, up to `ms`.
 * @param {string | (() => boolean)} what @param {number} [ms]
 */
async function until(what, ms = 15_000) {
  const ok = typeof what === 'string' ? () => existsSync(what) : what;
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${String(what)}`);
    await pause(5);
  }
}

/**
 * A child process running `body` with `acquireLock`, `releaseLock`, `ctx`, `bar` (a barrier
 * file's path by name), `until(name)` (wait for one) and `mark(name, text?)` (write one) in scope.
 * @param {string} dir the barrier directory @param {Record<string, unknown>} ctx @param {string} body
 * @param {NodeJS.ProcessEnv} [env] its environment (default this process's)
 */
function child(dir, ctx, body, env = process.env) {
  const code = `
    import { acquireLock, releaseLock } from ${JSON.stringify(LOCKS)};
    import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const ctx = ${JSON.stringify(ctx)};
    const bar = (n) => join(${JSON.stringify(dir)}, n);
    const until = async (n) => { while (!existsSync(bar(n))) await new Promise((r) => setTimeout(r, 5)); };
    const mark = (n, text = '') => writeFileSync(bar(n), text);
    ${body}`;
  const c = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.add(c);
  let out = '';
  c.stdout?.on('data', (d) => (out += d));
  const exited = new Promise((resolve) =>
    c.once('exit', (code, signal) => resolve({ code, signal, out })),
  );
  return {
    proc: c,
    pid: /** @type {number} */ (c.pid),
    /** @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, out: string }>} */
    exited: () => /** @type {any} */ (exited),
  };
}

/** A process that only lives, for a lock to follow (as a shell that runs the command line). */
function sleeper() {
  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  children.add(c);
  return c;
}

/** @param {import('node:child_process').ChildProcess} c @param {NodeJS.Signals} [signal] */
async function stop(c, signal = 'SIGKILL') {
  if (c.exitCode !== null || c.signalCode !== null) return;
  const gone = new Promise((r) => c.once('exit', r));
  c.kill(signal);
  await gone;
}

/** @param {string} prefix */
function setup(prefix) {
  const root = tempDir(`hitld-lockp-${prefix}-`);
  const dir = join(root, 'bar');
  mkdirSync(dir);
  return { ctx: { machineRoot: join(root, 'machine') }, dir, root };
}

const gpu = (/** @type {{ machineRoot: string }} */ ctx) => lockStatus(ctx, ['gpu'])[0];

test('an executor asking again from its shell while others queue renews at once', async () => {
  const { ctx, dir } = setup('again');
  // As the command line takes it: each ask is its own process, following the shell that ran it.
  const shell = sleeper();
  const ask = (/** @type {string} */ name, /** @type {boolean} */ wait) =>
    child(
      dir,
      ctx,
      `const r = await acquireLock(ctx, { resource: 'gpu', holder: ${JSON.stringify(name)}, pid: ${shell.pid}, autoRenew: false, wait: ${wait}, timeoutMs: 5000 });
      console.log(JSON.stringify({ acquired: r.acquired, renewed: r.renewed ?? null, waited_ms: r.waited_ms }));`,
    );
  const first = JSON.parse((await ask('D-A', false).exited()).out);
  assert.equal(first.acquired, true);
  const b = child(
    dir,
    ctx,
    `const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-B', wait: true, autoRenew: false, timeoutMs: 15000 });
    console.log(r.acquired ? 'B granted' : 'B not'); mark('b-done'); await until('b-exit'); r.acquired && r.handle.release();`,
  );
  await until(() => gpu(ctx).waiting.includes('D-B'));
  const again = JSON.parse((await ask('D-A', true).exited()).out);
  assert.equal(again.acquired, true, 'not queued behind B');
  assert.equal(again.renewed, true);
  assert.ok(again.waited_ms < 1000, `renewed at once, not after ${again.waited_ms} ms`);
  assert.deepEqual(gpu(ctx).waiting, ['D-B'], 'B stays queued');
  // The command line's unlock, from the same shell: the hold taken for it goes.
  /** @type {Record<string, unknown>[]} */
  const logged = [];
  const logging = {
    ...ctx,
    log: (/** @type {string} */ kind, /** @type {object} */ data) => logged.push({ kind, ...data }),
  };
  assert.deepEqual(releaseLock(logging, { resource: 'gpu', holder: 'D-A', pid: shell.pid }), {
    released: true,
  });
  // The audit names who released it and for which process it asked.
  assert.deepEqual(logged, [
    { kind: 'lock_released', resource: 'gpu', holder: 'D-A', by_pid: process.pid, pid: shell.pid },
  ]);
  await until(join(dir, 'b-done'));
  writeFileSync(join(dir, 'b-exit'), '');
  assert.match((await b.exited()).out, /B granted/);
  await stop(shell);
});

test('two processes under one holder name: the second is refused at once, waiting or not', async () => {
  const { ctx, dir } = setup('same');
  const hold = child(
    dir,
    ctx,
    `const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-X' });
    mark('held'); await until('go'); r.acquired && r.handle.release();`,
  );
  await until(join(dir, 'held'));
  const second = child(
    dir,
    ctx,
    `const a = await acquireLock(ctx, { resource: 'gpu', holder: 'D-X', wait: true, timeoutMs: 5000 });
    const b = await acquireLock(ctx, { resource: 'gpu', holder: 'D-X' });
    console.log(JSON.stringify([a.acquired, a.timed_out, a.held_by?.pid, b.acquired]));`,
  );
  const [acquired, timedOut, heldBy, plain] = JSON.parse((await second.exited()).out);
  assert.equal(acquired, false);
  assert.equal(timedOut, false, 'refused, not waited for');
  assert.equal(heldBy, hold.pid, 'the holder named');
  assert.equal(plain, false);
  writeFileSync(join(dir, 'go'), '');
  await hold.exited();
});

test('a holder killed outright lets the next waiter in within the poll limit', async () => {
  const { ctx, dir } = setup('kill9');
  const hold = child(
    dir,
    ctx,
    `await acquireLock(ctx, { resource: 'gpu', holder: 'D-H' }); mark('held'); setInterval(() => {}, 1000);`,
  );
  await until(join(dir, 'held'));
  const waiter = child(
    dir,
    ctx,
    `const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-W', wait: true, timeoutMs: 15000 });
    console.log(JSON.stringify({ acquired: r.acquired, at: Date.now() }));`,
  );
  await until(() => gpu(ctx).waiting.includes('D-W'));
  // Let the waiter's backoff reach its limit, then kill the holder: no file changes, no wake-up.
  await pause(2500);
  const killed = Date.now();
  await stop(hold.proc, 'SIGKILL');
  const got = JSON.parse((await waiter.exited()).out);
  assert.equal(got.acquired, true);
  assert.ok(got.at - killed < 1500, `admitted ${got.at - killed} ms after the kill`);
});

test("a stale handle's release, after a forced release, leaves the new holder in place", async () => {
  const { ctx, dir } = setup('stale');
  /** @type {Record<string, unknown>[]} */
  const logged = [];
  const old = child(
    dir,
    ctx,
    `const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-X' });
    mark('held'); await until('release');
    console.log(JSON.stringify([r.handle.release(), r.handle.release()]));`,
  );
  await until(join(dir, 'held'));
  // A live holder is left alone by a release for another process...
  assert.deepEqual(releaseLock(ctx, { resource: 'gpu', holder: 'D-X' }), {
    released: false,
    held_by: 'D-X',
    pid: old.pid,
  });
  // ...and ended by a forced one, which is logged with its identity.
  const forced = releaseLock(
    { ...ctx, log: (kind, data) => logged.push({ kind, ...data }) },
    { resource: 'gpu', holder: 'D-X', force: true },
  );
  assert.deepEqual(forced, { released: true });
  assert.equal(logged[0]?.kind, 'lock_forced');
  assert.equal(/** @type {any} */ (logged[0]?.holders)[0].pid, old.pid);
  assert.equal(logged[0]?.by_pid, process.pid, 'who forced it');
  assert.equal(logged[0]?.pid, undefined, 'a forced release asks for no process');
  const next = child(
    dir,
    ctx,
    `const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-X' });
    console.log(r.acquired ? 'granted' : 'not'); mark('next'); setInterval(() => {}, 1000);`,
  );
  await until(join(dir, 'next'));
  writeFileSync(join(dir, 'release'), '');
  assert.deepEqual(JSON.parse((await old.exited()).out), [false, false]);
  const s = gpu(ctx);
  assert.equal(s.held_by, 'D-X');
  assert.equal(s.record?.pid, next.pid, "the new holder's record is in place");
  await stop(next.proc);
});

test('a live holder blocked past its expiry in a synchronous child process keeps the lock', async () => {
  const { ctx, dir } = setup('blocked');
  // As the merge gate blocks in spawnSync: the renewal timer cannot run while it waits.
  const hold = child(
    dir,
    ctx,
    `import { spawnSync } from 'node:child_process';
    const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-GATE', ttlSeconds: 1 });
    mark('held');
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 3000)']);
    console.log(r.handle.release() ? 'released' : 'lost');`,
  );
  await until(join(dir, 'held'));
  const expires = Date.parse(/** @type {string} */ (gpu(ctx).record?.expires_at));
  await until(() => Date.now() > expires + 500);
  assert.equal(gpu(ctx).stale, null, 'not stale past its expiry');
  const other = await acquireLock(ctx, { resource: 'gpu', holder: 'D-OTHER', autoRenew: false });
  assert.equal(other.acquired, false, 'not taken over');
  assert.equal(!other.acquired && other.held_by?.holder, 'D-GATE');
  assert.equal((await hold.exited()).out.trim(), 'released', 'it still held it when it woke');
});

test('processes hammering a capacity of 4 never hold more than 4, by an append-only log', async () => {
  const { dir, root } = setup('hammer');
  const ctx = { machineRoot: join(root, 'machine'), capacity: { gpu: 4 } };
  const log = join(root, 'grants.log');
  writeFileSync(log, '');
  const weights = [1, 1, 2, 2, 3, 4, 1, 2];
  // A grant is logged after it is granted and a release before it is released, so the log's
  // running sum is never more than what was really held: more than 4 in it is a real overlap.
  const procs = weights.map((w, i) =>
    child(
      dir,
      ctx,
      `await until('go');
      for (let n = 0; n < 12; n++) {
        const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-${i}', weight: ${w}, wait: true, pollMs: 2, maxPollMs: 20, timeoutMs: 60000 });
        if (!r.acquired) throw new Error('not acquired');
        appendFileSync(${JSON.stringify(log)}, '+${w} D-${i}\\n');
        await new Promise((res) => setTimeout(res, Math.floor(Math.random() * 4)));
        appendFileSync(${JSON.stringify(log)}, '-${w} D-${i}\\n');
        r.handle.release();
      }
      console.log('done');`,
    ),
  );
  writeFileSync(join(dir, 'go'), '');
  const outs = await Promise.all(procs.map((p) => p.exited()));
  assert.deepEqual(
    outs.map((o) => o.out.trim()),
    weights.map(() => 'done'),
  );
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, weights.length * 12 * 2);
  let held = 0;
  let max = 0;
  for (const line of lines) {
    held += Number(line.split(' ')[0]);
    max = Math.max(max, held);
    assert.ok(held <= 4, `held ${held} of 4 at: ${line}`);
  }
  assert.equal(held, 0);
  assert.ok(max > 1, `holders shared the resource (at most ${max} at once)`);
});

/** An older copy's record: no token, boot or format marker. @param {number} pid @param {string} holder */
const olderRecord = (pid, holder) => {
  const now = Date.now();
  return {
    resource: 'gpu',
    holder,
    pid,
    pid_start: processStart(pid),
    host: hostname(),
    acquired_at: new Date(now).toISOString(),
    renewed_at: new Date(now).toISOString(),
    expires_at: new Date(now + 300_000).toISOString(),
  };
};

test("an older copy's record and ticket are respected, and status flags them", async () => {
  const { ctx } = setup('older');
  const locks = join(ctx.machineRoot, 'locks');
  mkdirSync(join(locks, 'gpu.queue'), { recursive: true });
  const holder = sleeper();
  const waiter = sleeper();
  writeFileSync(
    join(locks, 'gpu.lock'),
    JSON.stringify(olderRecord(/** @type {number} */ (holder.pid), 'D-OLD')) + '\n',
  );
  // Its ticket as an older copy names and writes it: the waiter's name and pid only.
  const ticket = `${String(Date.now()).padStart(15, '0')}.abcdef.${waiter.pid}.t`;
  writeFileSync(
    join(locks, 'gpu.queue', ticket),
    JSON.stringify({ holder: 'D-OLDW', pid: waiter.pid }) + '\n',
  );

  const plain = await acquireLock(ctx, { resource: 'gpu', holder: 'D-NEW', autoRenew: false });
  assert.equal(plain.acquired, false, 'its holder is alive');
  const s = gpu(ctx);
  assert.deepEqual(s.legacy, { records: 1, tickets: 1 });
  assert.equal(s.holders[0].legacy, true);
  assert.deepEqual(
    s.waiters.map((w) => [w.holder, w.legacy]),
    [['D-OLDW', true]],
  );

  const ac = new AbortController();
  const queued = acquireLock(ctx, {
    resource: 'gpu',
    holder: 'D-NEW',
    wait: true,
    autoRenew: false,
    signal: ac.signal,
  });
  await until(() => gpu(ctx).waiting.length === 2);
  // The older holder goes; the older waiter is still ahead.
  await stop(holder);
  await until(() => gpu(ctx).stale !== null);
  assert.deepEqual(gpu(ctx).waiting, ['D-OLDW', 'D-NEW']);
  // The older waiter goes too: the line is ours.
  await stop(waiter);
  const got = await Promise.race([queued, pause(5000).then(() => null)]);
  assert.ok(got?.acquired, 'granted once the older waiter is gone');
  got?.acquired && got.handle.release();
  ac.abort();
});

test('a ticket whose pid now names another process does not hold the head of the line', async () => {
  const { ctx } = setup('ghost');
  const queue = join(ctx.machineRoot, 'locks', 'gpu.queue');
  mkdirSync(queue, { recursive: true });
  // A live process, but not the waiter the ticket was written for: its start time differs.
  const other = sleeper();
  const ticket = `${String(Date.now() - 1000).padStart(15, '0')}.abcdef.${other.pid}.t`;
  writeFileSync(
    join(queue, ticket),
    JSON.stringify({
      holder: 'D-GHOST',
      pid: other.pid,
      // Its identity as it was: another process's now.
      start: `${processIdentity(/** @type {number} */ (other.pid))}0`,
      boot: null,
      v: 2,
    }) + '\n',
  );
  assert.deepEqual(gpu(ctx).waiting, [], 'not shown as waiting');
  const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-1', wait: true, timeoutMs: 3000 });
  assert.ok(r.acquired, 'not held behind the ghost');
  assert.deepEqual(readdirSync(queue), [], 'the ghost ticket was dropped');
  r.acquired && r.handle.release();
  await stop(other);
});

test("a waiter's signal or abort takes its ticket with it; a holder's signal releases its hold", async () => {
  const { ctx, dir } = setup('signal');
  const hold = child(
    dir,
    ctx,
    `await acquireLock(ctx, { resource: 'gpu', holder: 'D-H' }); mark('held'); setInterval(() => {}, 1000);`,
  );
  await until(join(dir, 'held'));
  const waiter = child(
    dir,
    ctx,
    `await acquireLock(ctx, { resource: 'gpu', holder: 'D-W', wait: true });`,
  );
  await until(() => gpu(ctx).waiting.includes('D-W'));
  waiter.proc.kill('SIGTERM');
  const w = await waiter.exited();
  assert.equal(w.signal, 'SIGTERM', 'the signal is raised again once the ticket is gone');
  assert.deepEqual(gpu(ctx).waiting, []);
  assert.deepEqual(readdirSync(join(ctx.machineRoot, 'locks', 'gpu.queue')), []);

  const ac = new AbortController();
  const aborted = acquireLock(ctx, {
    resource: 'gpu',
    holder: 'D-A',
    wait: true,
    signal: ac.signal,
  });
  await until(() => gpu(ctx).waiting.includes('D-A'));
  ac.abort();
  const a = await aborted;
  assert.equal(a.acquired, false);
  assert.equal(!a.acquired && a.aborted, true);
  assert.deepEqual(gpu(ctx).waiting, []);

  hold.proc.kill('SIGINT');
  const h = await hold.exited();
  assert.equal(h.signal, 'SIGINT');
  assert.equal(gpu(ctx).held_by, null, 'its hold went before it ended');
});

test('a waiter behind a holder the clock no longer vouches for does not start ps on every look', async () => {
  const { ctx } = setup('probe');
  const holder = sleeper();
  const record = olderRecord(/** @type {number} */ (holder.pid), 'D-CLI');
  // Renewed long ago, as a command-line hold is (it is never renewed): its start time is compared.
  const long = Date.now() - 60_000;
  Object.assign(record, {
    renewed_at: new Date(long).toISOString(),
    acquired_at: new Date(long).toISOString(),
    start: processIdentity(/** @type {number} */ (holder.pid)),
    v: 2,
  });
  mkdirSync(join(ctx.machineRoot, 'locks'), { recursive: true });
  writeFileSync(join(ctx.machineRoot, 'locks', 'gpu.lock'), JSON.stringify(record) + '\n');
  const before = probes.runs;
  const r = await acquireLock(ctx, {
    resource: 'gpu',
    holder: 'D-W',
    wait: true,
    timeoutMs: 2000,
    pollMs: 10,
    maxPollMs: 50,
  });
  assert.equal(r.acquired, false);
  const runs = probes.runs - before;
  // About 40 looks in 2 s; on Linux the start tick keys the cache, elsewhere it lasts 2 s.
  assert.ok(runs <= 3, `${runs} start-time lookups`);
  await stop(holder);
});

test('status names the copies on PATH that write the older lock format', () => {
  const root = tempDir('hitld-lockp-path-');
  /** @param {string} name @param {string} core @param {string} version */
  const copy = (name, core, version) => {
    const at = join(root, name);
    mkdirSync(join(at, 'core', 'lib', 'env'), { recursive: true });
    mkdirSync(join(at, 'core', 'bin'), { recursive: true });
    writeFileSync(join(at, 'core', 'lib', 'env', 'lockcore.mjs'), core);
    writeFileSync(join(at, 'package.json'), JSON.stringify({ version }));
    writeFileSync(join(at, 'core', 'bin', 'hitld'), '');
    return at;
  };
  const old = copy('old', '// no format marker\n', '0.1.0-rc.1');
  const current = copy('current', 'export const LOCK_FORMAT = 2;\n', '0.1.0-rc.2');
  const path = [join(old, 'core', 'bin'), join(current, 'core', 'bin'), join(root, 'none')];
  assert.deepEqual(
    outdatedCopies(path.join(delimiter)).map((c) => [c.root, c.version]),
    [[old, '0.1.0-rc.1']],
  );
});

test("a holder and a taker in different time zones: the taker is refused and the waiter's ticket stays", async () => {
  const { ctx, dir } = setup('tz');
  // `ps` prints a start time in its caller's time zone: these read one process five hours apart.
  const utc = { ...process.env, TZ: 'UTC' };
  const away = { ...process.env, TZ: 'America/New_York' };
  const hold = child(
    dir,
    ctx,
    `await acquireLock(ctx, { resource: 'gpu', holder: 'D-UTC', autoRenew: false });
    mark('held'); setInterval(() => {}, 1000);`,
    utc,
  );
  await until(join(dir, 'held'));
  // Renewed long ago and past its expiry, as a command-line hold comes to be: only its identity
  // keeps it now.
  const file = join(ctx.machineRoot, 'locks', 'gpu.lock');
  const long = Date.now() - 60_000;
  writeFileSync(
    file,
    JSON.stringify({
      ...JSON.parse(readFileSync(file, 'utf8')),
      renewed_at: new Date(long).toISOString(),
      expires_at: new Date(long + 1_000).toISOString(),
    }) + '\n',
  );
  const waiter = child(
    dir,
    ctx,
    `const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-W', wait: true, timeoutMs: 20000 });
    console.log(r.acquired ? 'granted' : 'not');`,
    utc,
  );
  await until(() => gpu(ctx).waiting.includes('D-W'));
  const taker = child(
    dir,
    ctx,
    `const r = await acquireLock(ctx, { resource: 'gpu', holder: 'D-AWAY', autoRenew: false });
    console.log(JSON.stringify({ acquired: r.acquired, by: r.held_by?.holder ?? null }));`,
    away,
  );
  assert.deepEqual(JSON.parse((await taker.exited()).out), { acquired: false, by: 'D-UTC' });
  assert.equal(gpu(ctx).stale, null, 'the live holder is not judged reused');
  assert.deepEqual(gpu(ctx).waiting, ['D-W'], "the waiter's ticket is not dropped as a ghost");
  await stop(hold.proc);
  assert.match((await waiter.exited()).out, /granted/);
});
