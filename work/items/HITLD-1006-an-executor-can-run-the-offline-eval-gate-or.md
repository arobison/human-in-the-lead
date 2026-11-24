---
id: HITLD-1006
title: An executor can run the offline eval gate, or the work item says which command to leave to the orchestrator
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- Investigation first: find which command the executor guard refused when an executor on HITLD-1002 tried the offline eval gate, and why (the cause is not known; HITLD-1003 is one possible cause but is not confirmed to be this one).
- Then either the executor guard lets an executor run the gate, or the execute skill and the dispatch brief name the command the executor must leave to the orchestrator and where its result goes; a test or eval scenario covers it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The executor on pull request 602 (HITLD-1002) reported on 2026-11-24 that it could not run the eval gate because the guard refused it; the pull request's own `evals` check passed. An executor that cannot run a gate the pull request is held to opens the pull request without knowing whether it passes. Filed as an investigation: one sighting, the cause is unknown, and the decision it affects is whether executors may run gates.

## Notes

rc.3. One sighting. Related: HITLD-1003. If a second sighting names the same refusal as HITLD-1003, fold this item into it.
