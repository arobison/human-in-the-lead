---
id: HITLD-1069
title: One merge run does one clone, install and build, shared by the fast checks and the batch test suite
kind: work
state: proposed
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The time one merge run spends on clone, install and build is measured, per step, for the fast checks and for the batch suite, from recent merge runs; the figures are in the item.
- From the measurement, a change makes the merge run set up once and share the result between the fast checks and the batch suite, with a test that shows setup ran once and that a branch which changes dependencies still gets its own install (HITLD-1054's rule holds).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 681: within one merge run the fast checks and the batch test suite each clone, install and build, so the same setup work happens twice. It is a cost of every merge, not of one branch.

## Notes

rc.3, proposed: measure first. Builds on HITLD-1054 (rc.2: the install runs on the branch under test). Related: HITLD-1068 (reusing a passing result when main moves), HITLD-131 (faster checks, done). A change to the merge path is owner-held.
