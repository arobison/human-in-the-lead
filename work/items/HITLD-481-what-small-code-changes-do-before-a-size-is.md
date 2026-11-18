---
id: HITLD-481
title: What small code changes do before a size is learned
kind: decision
state: done
created: 2026-11-18
project: HITLD-15
decider: owner
answer: "Small is not the right measure: think about agents and what is aware of the attention budget"
answered_at: 2026-11-18T05:28:24.549Z
answered_via: question-tool
answered_by: owner
---

## Question

Until the system has enough evidence to learn what small means for code, what should small code changes do?

The owner said small is not the right measure; the design should think about agents and what is aware of the owner's attention budget.

## Options and recommendation

- A. Wait until a limit is learned: Small code changes keep waiting until a limit is learned.
- B. Start from a conservative fixed limit: 150 lines and 5 files at first.
- C. Learn from the start: No starting limit.

Recommended: Wait until a limit is learned. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
