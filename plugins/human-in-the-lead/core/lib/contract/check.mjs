// hitld check contract: the block is in AGENTS.md at the plugin's version and unedited, and a
// CLAUDE.md, if there is one, imports AGENTS.md (design part 15.2).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareBlock, importsAgents } from './block.mjs';

/**
 * @param {string} dir the project root
 * @param {string} [version]
 * @param {string} [key] the project's ID key, from policy.json
 */
export function checkContract(dir, version, key) {
  /** @type {string[]} */
  const errors = [];
  const agents = join(dir, 'AGENTS.md');
  /** @type {ReturnType<typeof compareBlock>} */
  let block;
  if (existsSync(agents)) {
    block = compareBlock(readFileSync(agents, 'utf8'), version, key);
  } else {
    block = {
      status: 'missing',
      expected: version ?? '',
      message: 'no AGENTS.md; run hitld install',
    };
  }
  if (block.status !== 'current') errors.push(`AGENTS.md: ${block.message}`);
  const claude = join(dir, 'CLAUDE.md');
  const claudeExists = existsSync(claude);
  const imports = claudeExists ? importsAgents(readFileSync(claude, 'utf8')) : null;
  if (claudeExists && !imports) {
    errors.push('CLAUDE.md does not import AGENTS.md: add a line "@AGENTS.md"');
  }
  return {
    ok: errors.length === 0,
    block: block.status,
    ...(block.found ? { found_version: block.found } : {}),
    expected_version: block.expected,
    claude_md: !claudeExists ? 'absent' : imports ? 'imports' : 'missing-import',
    ...(block.drift ? { drift: block.drift } : {}),
    errors,
  };
}
