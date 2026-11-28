// The chief-of-staff and orchestrate skills say how an owner's approval of a pull request the
// queue has not presented yet is recorded and applied (HITLD-1029, after HITLD-821).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** @param {string} name */
const skill = (name) =>
  readFileSync(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), 'utf8');

/** @param {string} text */
const oneLine = (text) => text.replace(/\s+/g, ' ');

test('the chief-of-staff skill records an approval before a presentation with --head', () => {
  const text = oneLine(skill('chief-of-staff'));
  const bullet = text.match(/- \*\*Merges in owner mode\.\*\*.*?(?= - \*\*)/)?.[0] ?? '';
  assert.match(bullet, /approves a pull request the queue has not presented yet/);
  assert.ok(
    bullet.includes(
      '`hitld merge approve --only <branch> --head <sha> --signoff "<the owner\'s sign-off>"`, `--head` naming the full head commit the owner saw',
    ),
  );
  assert.match(
    bullet,
    /It applies when the queue presents that head, or that head followed only by clean merges of main, whether the queue or the executor pushed them; it is dropped if the branch is sent back or the head changes by anything else/,
  );
  assert.match(bullet, /`no-pull-request`/);
  assert.match(bullet, /refused as `stale`/);
  assert.match(
    bullet,
    /Wake the orchestrator with `merge approved` when the result says `presented: true`/,
  );
});

test('the orchestrate skill says an approval can arrive before a presentation and plain hitld merge applies it', () => {
  const text = oneLine(skill('orchestrate'));
  assert.match(
    text,
    /an approval can arrive before a presentation \(the chief of staff records it for a pull request head with `--head`\): plain `hitld merge` applies it/,
  );
  assert.match(
    text,
    /An approval can also arrive before the queue presents a pull request, recorded for its head \(`--head`\); plain `hitld merge` applies it/,
  );
  assert.match(text, /`approved_ahead` says whether it was applied, dropped or expired/);
  assert.match(
    text,
    /Once applied, an approval, early or not, holds across the queue's own updates/,
  );
});
