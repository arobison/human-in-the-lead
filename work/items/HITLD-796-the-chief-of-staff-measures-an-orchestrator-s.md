---
id: HITLD-796
title: The chief of staff measures an orchestrator's context from its session record and sets handover-due, and the default handover thresholds drop to 0.3 and 8
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M814Y2YD67VCWT
release_note: "The chief of staff records the context share it measures from an orchestrator's session record with `hitld run context`, and past `orchestrator.handover_context_share` `hitld dispatch start` refuses with `handover-due`; the package defaults for the hand-over drop to 0.3 of the context and 8 completions."
---

## Why

The owner decided (HITLD-794) that the chief of staff measures an orchestrator's context and makes the handover due. Today the share is self-reported (`hitld run status --context-percent <N>`), nothing measures it and nothing blocks `dispatch start` on context, so only the completion count (default 20) is enforced; the 0.7 that orch-5 kept quoting was the threshold, not a measurement. The chief of staff can read any session's real context use from its session record.

## Done when

- The chief-of-staff skill has the chief of staff read a started orchestrator's context use from its session record at each wake and check-in and report it with `hitld run status --context-percent <N>` (or the equivalent command), so `handover.due` follows a measured number.
- When the share passes `orchestrator.handover_context_share` the chief of staff tells the orchestrator to hand over, and `hitld dispatch start` refuses with `handover-due` until it has.
- The package defaults for `orchestrator.handover_context_share` and `orchestrator.handover_after_completions` become 0.3 and 8 in the policy schema, with the design text updated in the same pull request.
- Tests cover the measured share passing the threshold, the refusal of a start, and the default values. A skill or schema change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.
