import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreRemoteError, isRemoteMoved, pushWithRetry } from '../lib/store/remote.mjs';
import { memoryRemote } from './helpers/memory-remote.mjs';
import { storeRemoteConformance } from './helpers/store-remote-conformance.mjs';

storeRemoteConformance('memory remote', () => {
  const m = memoryRemote();
  return { open: m.open, absentVersion: 'v999' };
});

test('pushWithRetry stops on an error that is not a stale head', async () => {
  const m = memoryRemote().open();
  const failing = {
    ...m,
    push: async () => {
      throw new StoreRemoteError('remote-unreachable', 'offline');
    },
  };
  await assert.rejects(
    pushWithRetry(failing, {
      bytes: Buffer.from('x'),
      expected: null,
      reconcile: async () => assert.fail('not a stale head'),
    }),
    (e) => !isRemoteMoved(e) && /** @type {StoreRemoteError} */ (e).code === 'remote-unreachable',
  );
  await assert.rejects(
    pushWithRetry(m, {
      bytes: Buffer.from('x'),
      expected: null,
      attempts: 0,
      reconcile: async () => assert.fail('never'),
    }),
    { code: 'remote-argument-invalid' },
  );
});
