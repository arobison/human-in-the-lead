#!/usr/bin/env node
// The status-line command `hitld install` sets up: records the session's rate limits as a usage
// snapshot and prints one short line. See core/harness/claude-code/statusline.mjs.

import { readFileSync } from 'node:fs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';

let line = 'hitld';
try {
  line = recordStatusLine(readFileSync(0, 'utf8'), { cwd: process.cwd(), env: process.env }).line;
} catch {
  line = 'hitld: usage not recorded';
}
process.stdout.write(`${line}\n`);
