---
id: HITLD-567
title: Work is paced to the plan
kind: milestone
state: proposed
created: 2026-11-19
project: HITLD-15
outcome: How much work runs follows the weekly plan, the machine and the owner's review capacity, with no fixed number standing in for them.
done_when:
  - "c1: Each project follows an even pace line on the account's total and its executor concurrency adapts to it, with no project reading another's data."
  - "c2: Heavy steps hold weighted machine capacity, and a performance run takes the machine."
  - "c3: An executor is stuck by progress and over by budget, and an item's execution profile (mode, model and effort, token budget) comes from measured history."
constraints: [HITLD-558 c1, HITLD-559 c2, HITLD-560 c3, HITLD-561 c3, HITLD-287 c3, HITLD-500 c3]
check: demo a project's starts slowing when the account total passes the line and recovering below it, with no fixed cap binding, run by the owner
---

## Notes

Made from the design walk-throughs of 2026-11-19 (HITLD-509, 493 and the decisions HITLD-530 to 534, 549, 550). The release stage is the owner's decision HITLD-551. The placement is the chief of staff's, a proposal for the owner to move.
