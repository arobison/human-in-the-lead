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
constraints: [HITLD-558 c1, HITLD-559 c2, HITLD-560 c3, HITLD-561 c3, HITLD-287 c3, HITLD-500 c3, HITLD-509 c1, HITLD-355 c1, HITLD-609 c2, HITLD-611 c3, HITLD-616 c3, HITLD-620 c2, HITLD-636 c2, HITLD-637 c2, HITLD-638 c2, HITLD-639 c2]
check: demo a project's starts slowing when the account total passes the line and recovering below it, with no fixed cap binding, run by the owner
---

## Notes

Made from the design walk-throughs of 2026-11-19 (HITLD-509, 493 and the decisions HITLD-530 to 534, 549, 550). The release stage is the owner's decision HITLD-551. The placement is the chief of staff's, a proposal for the owner to move.

## Changed on 2026-11-20 (HITLD-602)

HITLD-509 (target burn rate) and HITLD-355 (start past the usage gate) joined clause c1 on the owner's decision HITLD-602.

## Changed on 2026-11-20 (HITLD-610)

HITLD-609 (how a project's measurement tool plugs in) joined clause c2 on the owner's decision HITLD-610: the walk-through is placed here and happens before HITLD-559 (a performance run takes the machine) is built. HITLD-611 (what token usage a running session reports, and how often) joined clause c3 as a proposal: it feeds the executor budget (HITLD-560).

## Changed on 2026-11-20 (HITLD-615)

HITLD-616 (how a session calls out to executors on other harnesses and models) joined clause c3 as a proposal: a model other than Claude is a dimension of an item's execution profile.

## Changed on 2026-11-20 (HITLD-621)

HITLD-620 (the classification taxonomy) joined clause c2 on the owner's decision HITLD-621: it is settled before the measurement-tool design (HITLD-609) is built on, so HITLD-609 needs it.

HITLD-622 (a project-owned data area in the private store, from GitHub issue 363) joined clause c2 as a proposal; it needs HITLD-620 and HITLD-609.

HITLD-622 left clause c2 on the owner's decision HITLD-623 (dyno owns benchmark storage first) and moved to milestone HITLD-408, after v0.1.0.

HITLD-636, 637, 638 and 639 (the build items from the classification taxonomy walk-through) joined clause c2 as proposals.
