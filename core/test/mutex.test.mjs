// The cross-process mutex (core/lib/env/mutex.mjs) against the races of HITLD-241: a taker that
// judged a holder dead must not move aside the fresh directory that replaced it, must put back
// what it moved by mistake without replacing anyone's directory, and a creator whose fresh
// directory was moved aside before it wrote its owner file takes the loop again without waiting
// out the stale age. The races are made deterministic by wrapping node:fs for one call; that is
// why these tests have a file, and so a process, of their own. Each test names the part of the
// fix it pins.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs, {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { withMutex, withMutexSync } from '../lib/env/mutex.mjs';
import { tempDir } from './helpers/tmp.mjs';

const tmp = tempDir('hitld-mutex-');
let n = 0;
const lockDir = () => {
  const parent = join(tmp, `case-${n++}`);
  mkdirSync(parent);
  return join(parent, 'm');
};
const siblings = (/** @type {string} */ d) => readdirSync(join(d, '..')).sort();
const owner = (/** @type {string} */ d) => readFileSync(join(d, 'owner'), 'utf8');

/** The ID of a process that has exited. @returns {Promise<number>} */
const deadPid = () =>
  new Promise((done) => {
    const c = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    c.on('close', () => done(/** @type {number} */ (c.pid)));
  });

/** A mutex directory whose owner has exited. @param {string} d */
const deadHolder = async (d) => {
  mkdirSync(d);
  writeFileSync(join(d, 'owner'), `${await deadPid()}\n`);
};

/**
 * Replace node:fs functions for the length of `body`, for the mutex module too.
 * @template T
 * @param {Partial<Record<'writeFileSync' | 'readFileSync' | 'renameSync', (real: Function) => Function>>} wraps
 * @param {() => Promise<T>} body
 */
async function patched(wraps, body) {
  /** @type {Record<string, any>} */
  const anyFs = fs;
  const real = Object.fromEntries(Object.keys(wraps).map((k) => [k, anyFs[k]]));
  for (const [k, wrap] of Object.entries(wraps)) anyFs[k] = /** @type {Function} */ (wrap)(real[k]);
  syncBuiltinESMExports();
  try {
    return await body();
  } finally {
    Object.assign(anyFs, real);
    syncBuiltinESMExports();
  }
}

/**
 * Wrap renameSync so that the first time the mutex moves `d` aside, `before` runs first (the path
 * comes to name another directory after the taker's check) and `after` runs once it has moved.
 * Every rename of `d` aside, and every rename back onto `d`, is recorded.
 * @param {string} d @param {{ before?: () => void, after?: () => void }} hooks
 */
function onMoveAside(d, hooks) {
  const log = { aside: /** @type {string[]} */ ([]), back: /** @type {string[]} */ ([]) };
  const wrap = (/** @type {Function} */ real) =>
    function (/** @type {any[]} */ ...args) {
      const [from, to] = args.map(String);
      const first = from === d && log.aside.length === 0;
      if (from === d) log.aside.push(to);
      if (to === d) log.back.push(from);
      if (first) hooks.before?.();
      const out = real.apply(fs, args);
      if (first) hooks.after?.();
      return out;
    };
  return { log, wrap };
}

/** Make a fresh mutex directory at `d`, with an owner if given. @param {string} d @param {number} [pid] */
const fresh = (d, pid) => {
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d);
  if (pid) fs.writeFileSync(join(d, 'owner'), `${pid}\n`);
};

for (const [name, lock] of /** @type {const} */ ([
  ['withMutexSync', withMutexSync],
  ['withMutex', withMutex],
])) {
  // Pins: ENOENT on the owner write is a lost race; an orphan is taken after orphanMs, not staleMs.
  test(`${name}: an owner write that finds its directory moved aside is a lost race, and no long wait`, async () => {
    const d = lockDir();
    let done = false;
    const wrap = (/** @type {Function} */ real) =>
      function (/** @type {any[]} */ ...args) {
        if (done || args[0] !== join(d, 'owner')) return real.apply(fs, args);
        done = true;
        // A taker moves the fresh directory aside, finds it has no live owner yet is not the one
        // it judged, and puts it back: empty, and the creator's write has failed.
        fs.renameSync(d, `${d}.stale.1.1`);
        try {
          return real.apply(fs, args);
        } finally {
          fs.renameSync(`${d}.stale.1.1`, d);
        }
      };
    const t0 = Date.now();
    const ran = await patched({ writeFileSync: wrap }, async () =>
      lock(d, () => 'ran', { timeoutMs: 20_000 }),
    );
    assert.equal(ran, 'ran');
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms: the default 10 s stale age`);
    assert.deepEqual(siblings(d), [], 'released, nothing left aside');
  });

  // Pins: the identity read again after the owner (staleId).
  test(`${name}: a holder replaced after its owner was read dead keeps its directory`, async () => {
    const d = lockDir();
    await deadHolder(d);
    // Between the taker reading the dead owner and acting on it, the old directory goes and a
    // live process makes a fresh one: the release-and-exit of a holder, then the next acquirer.
    let swapped = false;
    const swap = (/** @type {Function} */ real) =>
      function (/** @type {any[]} */ ...args) {
        const out = real.apply(fs, args);
        if (!swapped && args[0] === join(d, 'owner')) {
          swapped = true;
          fresh(d, process.pid);
        }
        return out;
      };
    const { log, wrap } = onMoveAside(d, {});
    await patched({ renameSync: wrap, readFileSync: swap }, async () => {
      await assert.rejects(
        async () => lock(d, () => 'ran', { timeoutMs: 300 }),
        /timed out waiting for the lock/,
      );
    });
    assert.ok(swapped);
    assert.deepEqual(log.aside, [], 'the fresh directory was never moved aside');
    assert.equal(owner(d), `${process.pid}\n`, 'its owner is kept');
  });

  // Pins: the put-back of a live holder's directory moved by mistake.
  test(`${name}: a live holder's directory moved between the check and the rename is put back`, async () => {
    const d = lockDir();
    await deadHolder(d);
    const { log, wrap } = onMoveAside(d, { before: () => fresh(d, process.pid) });
    await patched({ renameSync: wrap }, async () => {
      await assert.rejects(
        async () => lock(d, () => 'ran', { timeoutMs: 300 }),
        /timed out waiting for the lock/,
      );
    });
    assert.equal(log.aside.length, 1, 'it was moved aside once');
    assert.equal(log.back.length, 1, 'and put back');
    assert.equal(owner(d), `${process.pid}\n`, 'the holder keeps its mutex');
    assert.deepEqual(siblings(d), ['m'], 'nothing is left aside');
  });

  // Pins: the identity half of the check on what was moved.
  test(`${name}: a creator's fresh directory moved by mistake is put back, not removed`, async () => {
    const d = lockDir();
    await deadHolder(d);
    /** @type {bigint | undefined} */
    let made;
    const before = () => {
      fresh(d);
      made = fs.statSync(d, { bigint: true }).ino;
    };
    const { log, wrap } = onMoveAside(d, { before });
    await patched({ renameSync: wrap }, async () => {
      await assert.rejects(
        async () => lock(d, () => 'ran', { timeoutMs: 300, orphanMs: 10_000 }),
        /timed out waiting for the lock/,
      );
    });
    assert.equal(log.back.length, 1, 'put back');
    assert.equal(fs.statSync(d, { bigint: true }).ino, made, 'the same directory, for its creator');
  });

  // Pins: the live-owner half of the check on what was moved.
  test(`${name}: an orphan whose creator writes its owner just before the rename is put back`, async () => {
    const d = lockDir();
    mkdirSync(d);
    const { log, wrap } = onMoveAside(d, {
      before: () => fs.writeFileSync(join(d, 'owner'), `${process.pid}\n`),
    });
    await patched({ renameSync: wrap }, async () => {
      await assert.rejects(
        async () => lock(d, () => 'ran', { timeoutMs: 300, orphanMs: 0 }),
        /timed out waiting for the lock/,
      );
    });
    assert.equal(log.back.length, 1, 'put back');
    assert.equal(owner(d), `${process.pid}\n`, 'the late creator holds it');
  });

  // Pins: the put-back never renames over a directory at the path (an empty one would be replaced).
  test(`${name}: the put-back never replaces a creator's empty directory`, async () => {
    const d = lockDir();
    await deadHolder(d);
    const { log, wrap } = onMoveAside(d, {
      before: () => fresh(d, process.pid), // a live holder, moved aside by mistake
      after: () => fs.mkdirSync(d), // and a creator midway at the path before the put-back
    });
    const ran = await patched({ renameSync: wrap }, async () =>
      lock(d, () => 'ran', { timeoutMs: 5000, orphanMs: 100 }),
    );
    assert.equal(ran, 'ran', 'the empty one was an orphan, and taken in time');
    assert.deepEqual(log.back, [], 'nothing was renamed onto the path');
    const left = siblings(d);
    assert.equal(left.length, 1, 'the live holder stays aside');
    assert.equal(owner(join(d, '..', left[0])), `${process.pid}\n`);
  });

  // Pins: a moved directory stays aside when the path is held.
  test(`${name}: the put-back leaves a moved directory aside when the path is held`, async () => {
    const d = lockDir();
    await deadHolder(d);
    const { wrap } = onMoveAside(d, {
      before: () => fresh(d, process.pid),
      after: () => fresh(d, process.ppid),
    });
    await patched({ renameSync: wrap }, async () => {
      await assert.rejects(
        async () => lock(d, () => 'ran', { timeoutMs: 300 }),
        /timed out waiting for the lock/,
      );
    });
    assert.equal(owner(d), `${process.ppid}\n`, 'the holder of the path keeps it');
    const aside = siblings(d).filter((s) => s !== 'm');
    assert.equal(aside.length, 1);
    assert.equal(owner(join(d, '..', aside[0])), `${process.pid}\n`, 'the moved one is kept');
  });

  // Pins: release removes the path only while it is ours, and our own directory where it was left.
  test(`${name}: a holder displaced while it held releases its own directory, not the new holder's`, async () => {
    const d = lockDir();
    const ran = await lock(
      d,
      () => {
        fs.renameSync(d, `${d}.stale.1.1`);
        fresh(d, process.ppid);
        return 'ran';
      },
      { timeoutMs: 1000 },
    );
    assert.equal(ran, 'ran');
    assert.equal(owner(d), `${process.ppid}\n`, 'the new holder keeps its directory');
    assert.deepEqual(siblings(d), ['m'], 'ours was removed from where it was left');
  });

  // Pins: the sweep of mutexes left aside: dead or long owner-less ones go, nothing else.
  test(`${name}: mutexes left aside are swept when dead, and kept while live or young`, async () => {
    const d = lockDir();
    const make = (/** @type {string} */ name, /** @type {number | null} */ pid, old = false) => {
      const p = `${d}.stale.${name}`;
      mkdirSync(p);
      if (pid) writeFileSync(join(p, 'owner'), `${pid}\n`);
      if (old) utimesSync(p, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    };
    make('dead', await deadPid());
    make('live', process.ppid);
    make('young', null);
    make('old', null, true);
    assert.equal(await lock(d, () => 'ran', { timeoutMs: 1000 }), 'ran');
    assert.deepEqual(siblings(d), ['m.stale.live', 'm.stale.young']);
  });

  // Pins: the deadline and the wait when looking again keeps failing.
  test(`${name}: a stale mutex that cannot be moved still times out`, async () => {
    const d = lockDir();
    await deadHolder(d);
    const refuse = (/** @type {Function} */ real) =>
      function (/** @type {any[]} */ ...args) {
        if (String(args[0]) === d)
          throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        return real.apply(fs, args);
      };
    const t0 = Date.now();
    await patched({ renameSync: refuse }, async () => {
      await assert.rejects(
        async () => lock(d, () => 'ran', { timeoutMs: 300 }),
        /timed out waiting for the lock/,
      );
    });
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  });

  test(`${name}: a holder that died holding it is still taken over`, async () => {
    const d = lockDir();
    await deadHolder(d);
    assert.equal(await lock(d, () => 'ran', { timeoutMs: 2000 }), 'ran');
    assert.deepEqual(siblings(d), [], 'released, nothing left aside');
    assert.ok(!existsSync(d));
  });
}
