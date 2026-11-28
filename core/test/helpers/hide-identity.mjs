// Preloaded with `node --import` by tests: makes the identity of the pids named in
// HIDE_IDENTITY_PIDS (comma-separated) unreadable to this process, as /proc does for another
// user's process under hidepid. Reading /proc/<pid>/stat for them throws EACCES; every other read
// is untouched, so this process still judges that /proc shows start ticks.

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const hidden = new Set(
  (process.env.HIDE_IDENTITY_PIDS ?? '')
    .split(',')
    .filter(Boolean)
    .map((p) => `/proc/${p}/stat`),
);
const readFileSync = fs.readFileSync;
/** @type {any} */ (fs).readFileSync = function (
  /** @type {any} */ path,
  /** @type {any[]} */ ...rest
) {
  if (typeof path === 'string' && hidden.has(path)) {
    throw Object.assign(new Error(`EACCES: permission denied, open '${path}'`), {
      code: 'EACCES',
    });
  }
  return readFileSync.call(this, path, ...rest);
};
syncBuiltinESMExports();
