---
id: HITLD-632
title: A role can only narrow its model's clearance
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: Role can only narrow the model's clearance (Recommended)
answered_at: 2026-11-20T03:57:53.693Z
answered_via: question-tool
answered_by: owner
---

## Question

Does a role (executor, orchestrator, chief of staff, curator) have its own clearance, separate from its model's?

HITLD-620: model clearances are decided (HITLD-630); roles already have least-privilege definitions the guard enforces (design 10, HITLD-265).

## Options and recommendation

- A. Role can only narrow the model's clearance: A session's effective clearance is the narrower of its model's and its role's; a role never exceeds its model's; widening for one task is the owner's recorded decision, never a standing grant to the system
- B. Model clearance only: Role does not matter
- C. Roles can hold wider standing grants: The owner gives a role a standing clearance beyond its model's

Recommended: Role can only narrow the model's clearance. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
