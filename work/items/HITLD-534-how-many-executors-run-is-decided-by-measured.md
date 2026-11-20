---
id: HITLD-534
title: How many executors run is decided by measured resources and the other limits, with the number as a ceiling
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. Measured resources and the other limits, number as ceiling: Heavy steps hold weighted machine capacity through a wrapper the executor hook enforces; a performance run takes the machine exclusively; where executors share a machine the count follows measured headroom, in the cloud each executor has its own container; also bounded by the pace share (HITLD-531), merge risk (HITLD-511) and the owner's awaiting-merge queue; max_executors stays as a hard ceiling"
answered_at: 2026-11-19T23:15:38.538Z
answered_via: question-tool
answered_by: owner
---

## Question

What should decide how many executors run at once, given that on a shared machine they compete for CPU, memory and disk?

HITLD-493: max_executors is a fixed number. The owner pointed out it was designed because executors on one machine compete for resources (heavy tests running together flake or distort performance measurements). HITLD-41 (resource capacities), HITLD-42 (load-aware admission) and HITLD-145 (the cap applies only to executors sharing a machine) are planned and unbuilt.

## Options and recommendation

- A. Measured resources and the other limits, number as ceiling: Heavy steps hold weighted machine capacity through a wrapper the executor hook enforces; a performance run takes the machine exclusively; where executors share a machine the count follows measured headroom, in the cloud each executor has its own container; also bounded by the pace share (HITLD-531), merge risk (HITLD-511) and the owner's awaiting-merge queue; max_executors stays as a hard ceiling
- B. Keep the fixed number per machine: A cap on executors per machine kind
- C. Measured resources only: Load alone decides

Recommended: Measured resources and the other limits, number as ceiling. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
