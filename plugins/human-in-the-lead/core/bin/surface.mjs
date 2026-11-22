#!/usr/bin/env node
// Write HITLD's own surface file (HITLD-755): the public interface of a checkout, one element per
// line (core/lib/release/surface.mjs), which `hitld release propose` diffs between releases of
// the package that declares it.
//   node core/bin/surface.mjs [<dir>] [--write <file>]
// Prints the file's text for <dir> (default the current directory), or writes it to <file>.
// A separate entry from the module: the command table it reads imports that module too.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { surfaceFileText } from '../lib/release/surface.mjs';

const { values, positionals } = parseArgs({
  options: { write: { type: 'string' } },
  allowPositionals: true,
});
const text = await surfaceFileText(positionals[0] ?? process.cwd());
if (typeof values.write === 'string') writeFileSync(values.write, text);
else process.stdout.write(text);
