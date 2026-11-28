// The skills that talk to the owner put every question through the harness's question tool, never
// leave one open at the end of a reply, and ask nothing in a reply that only informs (HITLD-1020).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** @param {string} name */
const skill = (name) =>
  readFileSync(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), 'utf8');

/** @param {string} text */
const oneLine = (text) => text.replace(/\s+/g, ' ');

test('the chief-of-staff skill asks every question with the question tool, not only decisions', () => {
  const text = oneLine(skill('chief-of-staff'));
  const bullet = text.match(/- \*\*The question tool\.\*\*.*?(?= - \*\*)/)?.[0] ?? '';
  assert.match(bullet, /every question you put to the owner goes through it, of any kind/);
  for (const kind of [
    'a decision item',
    'a judgment call',
    'a classification',
    'a scope or placement choice',
    'a yes or no on a side effect',
  ]) {
    assert.ok(bullet.includes(kind), kind);
  }
  assert.match(bullet, /one question per call, or several in one call/);
  assert.match(bullet, /recommendation first/);
  assert.match(
    bullet,
    /never ends in an open question, an "if you want X, tell me", or a list of options/,
  );
  assert.match(bullet, /only informs, with nothing for the owner to decide, asks nothing/);
  assert.match(bullet, /Without such a tool, send the question as text/);
});

test('the orchestrate skill repeats the rule where it talks to the owner itself', () => {
  const text = oneLine(skill('orchestrate'));
  assert.match(text, /every other question you put to the owner yourself, of any kind/);
  assert.match(text, /never ends in an open question, an "if you want X, tell me"/);
  assert.match(text, /A reply that only informs asks nothing/);
});
