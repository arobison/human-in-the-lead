#!/usr/bin/env node
// SessionStart: say when this session runs another release than the project pins, when the pin is
// ahead of the release that last wrote the run's data (an upgrade is due), or when the data is
// newer than this release reads (design part 16.5, Upgrades). Silent when all agree. It reads only,
// and never stops the session: `hitld run start` and `run resume` make the same check and refuse.

import { readHookInput, isExecutor } from './input.mjs';
import { sessionNotice } from '../../../lib/install/drift.mjs';

const input = readHookInput();
if (!isExecutor(input, process.env)) {
  try {
    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
    const text = sessionNotice({ cwd, env: process.env });
    if (text) process.stdout.write(`${text}\n`);
  } catch {
    // A check that cannot run says nothing here; run start and run resume check again.
  }
}
