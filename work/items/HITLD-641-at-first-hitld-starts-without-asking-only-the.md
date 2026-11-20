---
id: HITLD-641
title: At first HITLD starts without asking only the measurements an executor needs for its own item
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: Only what an executor needs for its own item (Recommended)
answered_at: 2026-11-20T04:14:15.228Z
answered_via: question-tool
answered_by: owner
---

## Question

Which measurements may HITLD start without asking the owner, at first?

HITLD-609: a measurement costs machine and farm time, not tokens, and can disturb other work; the trust engine (HITLD-552) holds the supervision modes.

## Options and recommendation

- A. Only what an executor needs for its own item: Within a per-item cap on how many; scheduled baselines on the main branch and a search for the commit a regression came in ask first until the trust engine has enough evidence to propose unlocking each kind
- B. Everything, within a machine-time budget: Executors, baselines and regression searches start without asking inside a budget
- C. Nothing without asking: Every measurement waits for the owner

Recommended: Only what an executor needs for its own item. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
