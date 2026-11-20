---
id: HITLD-71
title: Load aware
kind: milestone
state: planned
created: 2026-11-14
project: HITLD-28
outcome: Heavy work waits while the person's machine is busy, and benchmarks run on a quiet one.
done_when:
  - "c1: Serial resources have capacities and weighted holders that queue fairly."
  - "c2: Admission defers heavy work above the load threshold, and quiet holds start below it."
constraints: [HITLD-41 c1, HITLD-42 c2]
check: integration-test simulated load on a fixture machine profile
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "load-aware" of HITLD-28. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-28:

- **load-aware** (capability). Outcome: heavy work waits while the person's machine is busy. Done when: admission defers heavy work above the load threshold and quiet holds start below it, on a fixture machine profile. Check: an integration test with simulated load. Constraints: HITLD-41, HITLD-42.

Shaped by the planning pass HITLD-343 (2026-11-16). Stage: v0.1.0-rc.5 (HITLD-568), since 2026-11-20 (HITLD-592). In the cloud, executors often do not run on the measured machine (HITLD-145), which lowers this milestone's value there.

## Moved on 2026-11-20 (HITLD-592)

On the owner's approval of the nine roadmap moves (HITLD-592), this milestone joins v0.1.0-rc.5 (HITLD-568) and is now one of its needs, so the stage noted above ("after v0.1.0") no longer holds.
