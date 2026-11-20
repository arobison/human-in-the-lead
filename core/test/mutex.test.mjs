// The cross-process mutex (core/lib/env/mutex.mjs) against the race of HITLD-241: a taker that
// judged a holder dead must not move aside the fresh directory that replaced it, and a creator
// whose fresh directory was moved aside before it wrote its owner file takes the loop again.
// The races are made deterministic by wrapping node:fs for one call; that is why these tests have
// a file, and so a process, of their own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs, { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

/** The ID of a process that has exited. @returns {Promise<number>} */
const deadPid = () =>
  new Promise((done) => {
    const c = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    c.on('close', () => done(/** @type {number} */ (c.pid)));
  });

/**
 * Replace one node:fs function for the length of `body`, for the mutex module too.
 * @template T
 * @param {'writeFileSync' | 'readFileSync' | 'renameSync'} name
 * @param {(real: Function) => Function} wrap
 * @param {() => Promise<T>} body
 */
async function patched(name, wrap, body) {
  const real = fs[name];
  // @ts-ignore: a stand-in with the same arguments
  fs[name] = wrap(real);
  syncBuiltinESMExports();
  try {
    return await body();
  } finally {
    // @ts-ignore
    fs[name] = real;
    syncBuiltinESMExports();
  }
}

/**
 * A creator's fresh directory is moved aside between its creation and the owner write, by a taker
 * that then finds it is not stale and puts it back: the write fails with ENOENT.
 * @param {string} d
 */
const movedBeforeOwnerWrite = (d) => {
  let done = false;
  return (/** @type {Function} */ real) =>
    function (/** @type {any[]} */ ...args) {
      if (done || args[0] !== join(d, 'owner')) return real.apply(fs, args);
      done = true;
      fs.renameSync(d, `${d}.stale.1.1`);
      try {
        return real.apply(fs, args);
      } finally {
        fs.renameSync(`${d}.stale.1.1`, d);
      }
    };
};

for (const [name, lock] of /** @type {const} */ ([
  ['withMutexSync', withMutexSync],
  ['withMutex', withMutex],
])) {
  test(`${name}: an owner write that finds its directory moved aside is a lost race, not an error`, async () => {
    const d = lockDir();
    const ran = await patched('writeFileSync', movedBeforeOwnerWrite(d), async () =>
      lock(d, () => 'ran', { timeoutMs: 10_000, staleMs: 300 }),
    );
    assert.equal(ran, 'ran');
    assert.ok(!existsSync(d), 'released');
    assert.deepEqual(readdirSync(join(d, '..')), [], 'nothing is left aside');
  });

  test(`${name}: a holder replaced after its owner was read dead keeps its directory`, async () => {
    const d = lockDir();
    mkdirSync(d);
    writeFileSync(join(d, 'owner'), `${await deadPid()}\n`);
    // Between the taker reading the dead owner and acting on it, the old directory goes and a
    // live process makes a fresh one: the release-and-exit of a holder, then the next acquirer.
    let swapped = false;
    const swap = (/** @type {Function} */ real) =>
      function (/** @type {any[]} */ ...args) {
        const out = real.apply(fs, args);
        if (!swapped && args[0] === join(d, 'owner')) {
          swapped = true;
          fs.rmSync(d, { recursive: true, force: true });
          fs.mkdirSync(d);
          fs.writeFileSync(join(d, 'owner'), `${process.pid}\n`);
        }
        return out;
      };
    /** @type {string[]} */
    const moved = [];
    const watch = (/** @type {Function} */ real) =>
      function (/** @type {any[]} */ ...args) {
        if (args[0] === d) moved.push(String(args[1]));
        return real.apply(fs, args);
      };
    await patched('renameSync', watch, () =>
      patched('readFileSync', swap, async () => {
        await assert.rejects(
          async () => lock(d, () => 'ran', { timeoutMs: 300, staleMs: 10_000 }),
          /timed out waiting for the lock/,
        );
      }),
    );
    assert.ok(swapped);
    assert.deepEqual(moved, [], 'the fresh directory was never moved aside');
    assert.equal(readFileSync(join(d, 'owner'), 'utf8'), `${process.pid}\n`, 'its owner is kept');
  });

  test(`${name}: a holder that died holding it is still taken over`, async () => {
    const d = lockDir();
    mkdirSync(d);
    writeFileSync(join(d, 'owner'), `${await deadPid()}\n`);
    assert.equal(await lock(d, () => 'ran', { timeoutMs: 2000 }), 'ran');
    assert.deepEqual(readdirSync(join(d, '..')), [], 'released, nothing left aside');
  });
}
