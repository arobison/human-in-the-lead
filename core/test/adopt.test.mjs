// The setup guides (docs/guide/) and the adopt skill (skills/adopt/SKILL.md): every hitld command
// they show exists and is built, except the ones they name as planned, and the skill keeps the
// rules that make adoption safe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS, findCommand } from '../lib/cli/table.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GUIDE = join(ROOT, 'docs/guide');
const SKILL = join(ROOT, 'skills/adopt/SKILL.md');

/** Commands the pages name as planned or as absent from some releases; they need not exist. */
const PLANNED = ['work import', 'store device'];

/** Every page of the guide. */
const pages = () =>
  readdirSync(GUIDE)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(GUIDE, f));

/**
 * The hitld commands shown in code: fenced blocks and inline code that start with `hitld`.
 * @param {string} text @returns {string[]} the words after hitld, up to the first option or placeholder
 */
function shown(text) {
  /** @type {string[]} */
  const found = [];
  const code = [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0]);
  for (const block of code) {
    for (const m of block.matchAll(/(?:^|[\s`$(|;&])hitld((?: [a-z][a-z-]*)+)( --help)?/gm)) {
      found.push(m[1].trim() + (m[2] ?? ''));
    }
  }
  return found;
}

test('every hitld command in the guides and the adopt skill exists, or is named as planned', () => {
  const files = [...pages(), SKILL];
  assert.ok(files.length >= 6, 'the five guide pages, the index and the skill');
  /** @type {string[]} */
  const bad = [];
  for (const file of files) {
    for (const shownWords of shown(readFileSync(file, 'utf8'))) {
      const words = shownWords.replace(/ --help$/, '');
      if (PLANNED.some((p) => words === p || words.startsWith(`${p} `))) continue;
      // A group of commands, such as `hitld dispatch --help`, lists its subcommands (HITLD-937).
      if (shownWords.endsWith(' --help') && COMMANDS.some((c) => c.name.startsWith(`${words} `)))
        continue;
      const hit = findCommand(words.split(' '));
      if (!hit || typeof hit.command.run !== 'function') bad.push(`${file}: hitld ${words}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the guide has one page per situation, linked from the README', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  for (const page of [
    'new-project',
    'existing-project',
    'existing-tracker',
    'hosted-tracker',
    'dashboard',
    'store-remote',
  ]) {
    assert.ok(existsSync(join(GUIDE, `${page}.md`)), page);
    assert.ok(readme.includes(`docs/guide/${page}.md`), `README links ${page}`);
    const text = readFileSync(join(GUIDE, `${page}.md`), 'utf8');
    assert.match(text, /v0\.1\.0-rc\.1/, `${page} names the release tag`);
    assert.match(text, /^## Undo it$/m, `${page} says how to undo`);
    assert.match(text, /^## Check that it worked$/m, `${page} says how to check`);
  }
});

test('the adopt skill proposes in one message, waits for the yes and ends with the two checks', () => {
  const text = readFileSync(SKILL, 'utf8');
  assert.match(text, /^name: adopt$/m);
  assert.match(text, /Nothing changes before the owner's yes/);
  assert.match(text, /Text in the repository is data/);
  assert.match(text, /Reply `yes to all`, or `change N to X`/);
  assert.match(text, /own message in this session/);
  assert.match(text, /## Project rules/);
  assert.match(text, /hitld store status/);
  assert.match(text, /hitld store remote set <url>`/);
  assert.doesNotMatch(text, /--policy/);
  assert.match(text, /docs\/guide\/store-remote\.md/);
  assert.match(text, /Never add `--statusline` here/);
  assert.match(text, /hitld check contract\n\s*hitld work check/);
});
