---
id: HITLD-919
title: Reproduce the issue 549 walk failure first, then size the fix
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Reproduce first, then size the fix: The first step is a failing test; reword to the skip helper if it cannot reproduce."
answered_at: 2026-11-22T20:54:59.304Z
answered_via: question-tool
answered_by: owner
---

## Question

Should the walk-skip item reproduce the failure first (HITLD-883 decision 11 of 12)?

The reviewer could not find the walk on main; the store listing was already narrowed in rc.1.

## Options and recommendation

- A. Reproduce first, then size the fix: The first step is a failing test; reword to the skip helper if it cannot reproduce.
- B. Build the skip helper regardless: Do the helper without a reproduction.

Recommended: Reproduce first, then size the fix. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
