---
id: HITLD-71
title: Load aware
kind: capability
state: planned
created: 2026-11-14
project: HITLD-28
constraints: [HITLD-41 c?, HITLD-42 c?]
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "load-aware" of HITLD-28. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-28:

- **load-aware** (capability). Outcome: heavy work waits while the person's machine is busy. Done when: admission defers heavy work above the load threshold and quiet holds start below it, on a fixture machine profile. Check: an integration test with simulated load. Constraints: HITLD-41, HITLD-42.
