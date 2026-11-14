#!/usr/bin/env node
// The hitld command line. All logic lives in the library; see core/lib/cli/main.mjs.

import { main } from '../lib/cli/main.mjs';

process.exitCode = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
});
