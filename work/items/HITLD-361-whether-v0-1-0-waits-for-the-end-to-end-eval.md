---
id: HITLD-361
title: Whether v0.1.0 waits for the end-to-end eval runner
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "B. Yes, keep it: v0.1.0 waits for the end-to-end eval runner; HITLD-57 stays on the way to v0.1.0."
answered_at: 2026-11-16T18:04:57.304Z
answered_via: question-tool
answered_by: owner
---

## Question

Should v0.1.0 wait for the end-to-end eval runner (HITLD-57, about 1.4M tokens) through HITLD-146?

The wait exists today only because HITLD-146's Done-when has an eval clause.

## Options and recommendation

- A. No, move the eval clause: HITLD-146's eval scenario moves to HITLD-70; v0.1.0 no longer waits on HITLD-57.
- B. Yes, keep it: v0.1.0 waits for the end-to-end eval runner; HITLD-57 stays on the way to v0.1.0.

Recommended: No, move the eval clause. Decoupling keeps v0.1.0 smaller; the owner chose to keep the wait instead.

## Answer

Recorded in the front matter once answered.
