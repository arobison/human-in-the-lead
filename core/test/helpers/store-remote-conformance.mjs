// A conformance suite any StoreRemote must pass. A transport's test file calls it with a factory
// that makes a fresh, empty remote.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { StoreRemoteError, isRemoteMoved, pushWithRetry } from '../../lib/store/remote.mjs';

/**
 * @typedef {object} RemoteContext
 * @property {() => import('../../lib/store/remote.mjs').StoreRemote} open
 *   a new client of the same remote; two clients share nothing but the remote
 * @property {string} absentVersion a well-formed version id the remote never held
 * @property {() => void} [cleanup]
 */

/**
 * @param {string} name the transport's name, for the test titles
 * @param {() => Promise<RemoteContext> | RemoteContext} make a fresh empty remote
 */
export function storeRemoteConformance(name, make) {
  /** @param {(ctx: RemoteContext) => Promise<void>} body */
  const withRemote = (body) => async () => {
    const ctx = await make();
    try {
      await body(ctx);
    } finally {
      ctx.cleanup?.();
    }
  };
  /** @param {Promise<unknown>} p @param {string} code */
  const refused = (p, code) =>
    assert.rejects(p, (e) => e instanceof StoreRemoteError && e.code === code);

  test(
    `${name}: head is null on an empty remote`,
    withRemote(async (ctx) => {
      assert.equal(await ctx.open().head(), null);
    }),
  );

  test(
    `${name}: push then head; each push is a new version`,
    withRemote(async (ctx) => {
      const r = ctx.open();
      const a = await r.push(Buffer.from('one'), { expected: null });
      assert.equal(await r.head(), a);
      const b = await r.push(Buffer.from('one'), { expected: a });
      assert.notEqual(b, a, 'the same bytes pushed again are a new version');
      assert.equal(await r.head(), b);
      assert.equal(await ctx.open().head(), b, 'another client sees it');
    }),
  );

  test(
    `${name}: fetch returns the exact bytes, for old versions too`,
    withRemote(async (ctx) => {
      const r = ctx.open();
      const first = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      const second = randomBytes(1024 * 1024 + 7);
      const a = await r.push(first, { expected: null });
      const b = await r.push(second, { expected: a });
      assert.ok((await ctx.open().fetch(a)).equals(first));
      assert.ok((await ctx.open().fetch(b)).equals(second));
      await refused(r.fetch(ctx.absentVersion), 'remote-version-missing');
    }),
  );

  test(
    `${name}: a push behind the head is refused, and says what the head is`,
    withRemote(async (ctx) => {
      const r = ctx.open();
      const a = await r.push(Buffer.from('a'), { expected: null });
      const b = await r.push(Buffer.from('b'), { expected: a });
      await assert.rejects(r.push(Buffer.from('c'), { expected: a }), (e) => {
        assert.ok(isRemoteMoved(e));
        assert.deepEqual(/** @type {StoreRemoteError} */ (e).detail, { expected: a, actual: b });
        return true;
      });
      await refused(r.push(Buffer.from('c'), { expected: null }), 'remote-moved');
      assert.equal(await r.head(), b, 'a refused push changes nothing');
      assert.ok((await r.fetch(b)).equals(Buffer.from('b')));
    }),
  );

  test(
    `${name}: a push that expects a head on an empty remote is refused`,
    withRemote(async (ctx) => {
      const r = ctx.open();
      await assert.rejects(r.push(Buffer.from('a'), { expected: ctx.absentVersion }), (e) => {
        assert.ok(isRemoteMoved(e));
        assert.equal(/** @type {StoreRemoteError} */ (e).detail.actual, null);
        return true;
      });
      assert.equal(await r.head(), null);
    }),
  );

  test(
    `${name}: prune keeps the newest N and leaves the head alone`,
    withRemote(async (ctx) => {
      const r = ctx.open();
      /** @type {string[]} */
      const ids = [];
      for (let i = 0; i < 5; i++) {
        ids.push(await r.push(Buffer.from(`bundle ${i}`), { expected: ids[i - 1] ?? null }));
      }
      const pruned = await ctx.open().prune({ keep: 2 });
      assert.deepEqual(pruned.kept, ids.slice(3));
      assert.deepEqual(pruned.removed, ids.slice(0, 3));
      assert.equal(await r.head(), ids[4], 'the head is the same version');
      assert.ok((await r.fetch(ids[4])).equals(Buffer.from('bundle 4')));
      assert.ok((await r.fetch(ids[3])).equals(Buffer.from('bundle 3')));
      await refused(r.fetch(ids[0]), 'remote-version-missing');
      // Nothing more to drop: a no-op, and a keep larger than what is held.
      assert.deepEqual(await r.prune({ keep: 2 }), { kept: ids.slice(3), removed: [] });
      assert.deepEqual((await r.prune({ keep: 50 })).removed, []);
      // A client that has not seen the prune still pushes on the same head.
      const next = await ctx.open().push(Buffer.from('after'), { expected: ids[4] });
      assert.equal(await r.head(), next);
      assert.ok((await r.fetch(next)).equals(Buffer.from('after')));
      await refused(r.prune({ keep: 0 }), 'remote-argument-invalid');
      await refused(r.prune({ keep: 1.5 }), 'remote-argument-invalid');
      assert.deepEqual(await ctx.open().prune({ keep: 1 }), {
        kept: [next],
        removed: [ids[3], ids[4]],
      });
    }),
  );

  test(
    `${name}: prune on an empty remote does nothing`,
    withRemote(async (ctx) => {
      assert.deepEqual(await ctx.open().prune({ keep: 3 }), { kept: [], removed: [] });
      assert.equal(await ctx.open().head(), null);
    }),
  );

  test(
    `${name}: two clients pushing at once: one wins, one is refused`,
    withRemote(async (ctx) => {
      /** @type {string | null} */
      let expected = null;
      for (let round = 0; round < 4; round++) {
        const [one, two] = [ctx.open(), ctx.open()];
        /** @type {PromiseSettledResult<string>[]} */
        const results = await Promise.allSettled([
          one.push(Buffer.from(`one ${round}`), { expected }),
          two.push(Buffer.from(`two ${round}`), { expected }),
        ]);
        const won = results.filter((r) => r.status === 'fulfilled');
        const lost = results.filter((r) => r.status === 'rejected');
        assert.equal(won.length, 1, `round ${round}: exactly one push wins`);
        assert.equal(lost.length, 1);
        assert.ok(isRemoteMoved(/** @type {PromiseRejectedResult} */ (lost[0]).reason));
        expected = /** @type {PromiseFulfilledResult<string>} */ (won[0]).value;
        assert.equal(await ctx.open().head(), expected);
      }
    }),
  );

  test(
    `${name}: a refused push is retried after a pull and merge`,
    withRemote(async (ctx) => {
      const [mine, theirs] = [ctx.open(), ctx.open()];
      const base = await mine.push(Buffer.from('base'), { expected: null });
      const theirHead = await theirs.push(Buffer.from('theirs'), { expected: base });
      /** @type {(string | null)[]} */
      const seen = [];
      const id = await pushWithRetry(mine, {
        bytes: Buffer.from('mine'),
        expected: base,
        reconcile: async (actual) => {
          seen.push(actual);
          const pulled = await mine.fetch(/** @type {string} */ (actual));
          return { bytes: Buffer.concat([pulled, Buffer.from('+mine')]), expected: actual };
        },
      });
      assert.deepEqual(seen, [theirHead]);
      assert.equal(await mine.head(), id);
      assert.ok((await mine.fetch(id)).equals(Buffer.from('theirs+mine')));
      // Out of attempts: the last refusal reaches the caller.
      await assert.rejects(
        pushWithRetry(mine, {
          bytes: Buffer.from('x'),
          expected: base,
          attempts: 1,
          reconcile: async () => assert.fail('no retry with one attempt'),
        }),
        isRemoteMoved,
      );
    }),
  );
}
