---
id: HITLD-235
title: A probe tells whether a harness can run headless before tier 3 is dispatched
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-141]
---

## Why

HITLD-141 (dispatch does not launch headless tier-3 executors that cannot run the contract's commands) learns that a harness cannot run headless only after a refusal. The owner decided (2026-11-16, HITLD-231) that a probe should tell this before dispatch. Until it exists the cloud rule in the orchestrate skill (start tier 3 interactive unless the plan says headless is able) keeps tier 3 off headless.

## Done when

- A probe runs a trivial headless command of the harness before the first tier-3 dispatch of a run and records whether it was refused, in the run state, as `modes.headless` able or not able, with the reason.
- The probe's cost is counted as probe spend and not against any item's budget, and it is not repeated in the same run for the same harness.
- A refusal the probe or a later report records counts for this harness for the rest of the run (HITLD-232).
- A test covers a harness that refuses, one that allows, and a probe that cannot run (the mode stays unknown and tier 3 stays interactive).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised from D-16's digest on HITLD-141 (PR #180). Related to HITLD-165, the quota probe: the two could share one probe harness.
