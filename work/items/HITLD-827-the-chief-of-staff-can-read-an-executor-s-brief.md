---
id: HITLD-827
title: The chief of staff can read an executor's brief from the store, so it is not retyped from the orchestrator's message
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---


## Why

The orchestrator's `dispatch start` writes the executor's brief to a file in its own container, and the chief of staff starts the executor session from a copy of the brief text in the orchestrator's message. On 2026-11-22 the chief of staff retyped the brief for six executors, with edits, and one brief missed that report list lines start with a dash, which cost the HITLD-764 executor a follow-up.

## Done when

- `hitld dispatch start` writes the brief into the store (`dispatch/briefs/`) and the `start_session` line names it; `hitld dispatch brief <D>` prints it in any container that has the store.
- The chief-of-staff skill says to start the executor session from that text unchanged.
- Tests cover writing and reading a brief across two stores. A skill and dispatch change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
