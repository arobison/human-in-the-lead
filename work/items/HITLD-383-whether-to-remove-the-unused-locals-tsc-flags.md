---
id: HITLD-383
title: Whether to remove the unused locals tsc flags
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "B. Remove them: An executor deletes the unused locals; the owner merges."
answered_at: 2026-11-16T18:42:57.828Z
answered_via: question-tool
answered_by: owner
---

## Question

Remove the unused locals that tsc --noUnusedLocals flags on main, or leave the flag off?

CI's tsconfig does not enable the flag; nothing is blocked.

## Options and recommendation

- A. Leave the flag off, drop it: The item is dropped with a reason.
- B. Remove them: An executor deletes the unused locals; the owner merges.

Recommended: Leave the flag off, drop it. Nothing is blocked; the owner chose to remove them instead.

## Answer

Recorded in the front matter once answered.
