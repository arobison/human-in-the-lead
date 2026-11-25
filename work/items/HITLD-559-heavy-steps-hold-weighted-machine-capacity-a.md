---
id: HITLD-559
title: Heavy steps hold weighted machine capacity; a performance run takes the machine; executor count follows measured headroom
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
constraint_of: [HITLD-567 c2]
---

## Why

The fixed `max_executors` stood in for a real constraint: executors that share a machine compete for CPU, memory and disk, and heavy tests run together flake or distort performance measurements. The owner decided (HITLD-534) that measured resources and the other limits set the count, with the number as a ceiling. HITLD-41, 42 and 145 are the planned parts.

## What it should do

- Heavy steps (tests, builds, benchmarks) run through a wrapper that holds weighted machine capacity, enforced by the executor hook (HITLD-537); a performance run takes the machine exclusively and other heavy steps drain first.
- Capacities come from the machine profile; each item's footprint is learned from history; a test result records the load it ran under, so a failure under contention is re-run quietly before the branch is blamed.
- Where executors share a machine the count follows measured headroom; in the cloud each has its own container. The count is also bounded by the project's pace (HITLD-550), merge risk (HITLD-511) and the owner's awaiting-merge queue. `max_executors` stays as a hard ceiling.

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Builds on HITLD-41 (resource capacities), HITLD-42 (load-aware admission) and HITLD-145 (the cap applies only to executors that share a machine). Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.

## Sighting on 2026-11-20 (the first outside consumer, GitHub issue 363)

The consumer's session reported timing measurements that shared an 8-core machine with test suites at a load average near 50, so the measurements proved nothing. Its orchestrator had to pass a hand-written rule ("wait for a one-minute load under 4") into every brief. This is the case this item exists for: heavy steps must be gated by measured load, not by a rule in a brief. A status call from the tool that makes the measurement (HITLD-609) would give HITLD the gate.


GitHub issues 668 and 669 (feedback, 2026-11-25) ask for the same machine-wide quiet this item gates: a measurement holds the machine exclusively while heavy jobs from any project hold it shared, one status that every project reads, and work that needs a quiet machine told apart from ordinary heavy work so a strict load rule does not stall everything else. They belong with the benchmark gate here and with HITLD-983 and HITLD-1013; no new item. Replies are posted on both issues.
