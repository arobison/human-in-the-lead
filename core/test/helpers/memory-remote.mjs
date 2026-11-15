// An in-memory StoreRemote for tests: the same contract as a real transport, with nothing on disk.

import { StoreRemoteError, remoteMoved } from '../../lib/store/remote.mjs';

/**
 * One remote and any number of clients of it. Version ids are `v1`, `v2` and so on.
 * @returns {{ open: () => import('../../lib/store/remote.mjs').StoreRemote }}
 */
export function memoryRemote() {
  /** @type {{ id: string, bytes: Buffer }[]} */
  let versions = [];
  let seq = 0;
  const headId = () => (versions.length ? versions[versions.length - 1].id : null);
  return {
    open: () => ({
      async head() {
        return headId();
      },
      async fetch(version) {
        const v = versions.find((x) => x.id === version);
        if (!v) throw new StoreRemoteError('remote-version-missing', `no ${version}`);
        return Buffer.from(v.bytes);
      },
      async push(bytes, { expected }) {
        if (headId() !== expected) throw remoteMoved(expected, headId());
        const id = `v${++seq}`;
        versions.push({ id, bytes: Buffer.from(bytes) });
        return id;
      },
      async prune({ keep }) {
        if (!Number.isInteger(keep) || keep < 1) {
          throw new StoreRemoteError('remote-argument-invalid', 'keep must be 1 or more');
        }
        const removed = versions.slice(0, Math.max(0, versions.length - keep));
        versions = versions.slice(removed.length);
        return { kept: versions.map((v) => v.id), removed: removed.map((v) => v.id) };
      },
    }),
  };
}
