#!/usr/bin/env node
// The hitld command line. All logic lives in the library; see core/lib/cli/main.mjs.

import { main } from '../lib/cli/main.mjs';

// node:sqlite (the private store's index, loaded only by the store commands) prints an
// ExperimentalWarning when it loads. Drop that one warning, matched by its type and message;
// every other warning still prints.
const emitWarning = process.emitWarning;
process.emitWarning = /** @type {typeof process.emitWarning} */ (
  function (/** @type {string | Error} */ warning, /** @type {any[]} */ ...rest) {
    const type =
      typeof rest[0] === 'string'
        ? rest[0]
        : (rest[0]?.type ?? (warning instanceof Error ? warning.name : undefined));
    const message = typeof warning === 'string' ? warning : warning?.message;
    if (
      type === 'ExperimentalWarning' &&
      /^SQLite is an experimental feature/.test(message ?? '')
    ) {
      return;
    }
    return Reflect.apply(emitWarning, process, [warning, ...rest]);
  }
);

process.exitCode = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
});
