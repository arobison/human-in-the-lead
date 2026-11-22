---
id: HITLD-866
title: File the security review's findings as rc.2 items, forge enforcement first
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. File as rc.2 items, forge enforcement first: Items in rc.2 as constraints; forge-level protection first, hook fixes after."
answered_at: 2026-11-22T18:49:57.133Z
answered_via: question-tool
answered_by: owner
---

## Question

Where should the security review's findings be filed?

The Fable trust-boundary review found that the executor guard does not stop a hostile executor: it can shed the guard, use non-Bash tools, forge an owner approval through the queue state file, and bypass text rules. Each fix is a guard or rights change and needs the owner's own yes.

## Options and recommendation

- A. File as rc.2 items, forge enforcement first: Items in rc.2 as constraints; forge-level protection first, hook fixes after.
- B. File as rc.3 items: Record findings, keep rc.2 scope.
- C. Do not file; discuss first: Nothing filed until we go through each finding.

Recommended: File as rc.2 items, forge enforcement first. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
