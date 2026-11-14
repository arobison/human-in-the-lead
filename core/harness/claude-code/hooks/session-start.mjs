#!/usr/bin/env node
// SessionStart: put the plugin's hitld on the PATH of this session's shell commands, and say which
// plugin copy is loaded. `claude --plugin-dir` silently replaces an installed plugin of the same
// name, so the path and version are worth seeing (design part 16.3).

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readHookInput } from './input.mjs';
import { VERSION } from '../../../lib/version.mjs';

readHookInput();
const root = process.env.CLAUDE_PLUGIN_ROOT;
const envFile = process.env.CLAUDE_ENV_FILE;
if (root && envFile) {
  const line = `export PATH=${JSON.stringify(join(root, 'bin'))}:"$PATH"\n`;
  const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  if (!text.includes(line)) appendFileSync(envFile, line);
}
process.stdout.write(`human-in-the-lead ${VERSION} loaded from ${root ?? 'an unknown path'}.\n`);
