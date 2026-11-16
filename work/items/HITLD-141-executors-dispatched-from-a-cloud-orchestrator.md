---
id: HITLD-141
title: Executors dispatched from a cloud orchestrator can run the project's own commands
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

In the first self-hosted run, an orchestrator in a cloud session dispatched two tier-3 executors. Both ran headless, and both were refused `hitld`, `node`, `npm` and `git` by the permission mode they ran in. They claimed nothing and committed nothing. The planner had no way to know, so it dispatched anyway, and `dispatch complete` flagged only that the report was not in the fixed shape. The orchestrator then had to stop and ask the owner, who does not run executors and should not need to widen permissions by hand. The chief of staff never executes work, so the system must make executors able to run, or say before launch that they cannot.

## Done when

- `hitld dispatch plan` and `dispatch start` check, before launching an executor, that its permission mode and the project's allow rules let it run the commands the contract requires (`hitld`, `node`, `npm`, `git`). When they do not, the item is held with a named reason (for example `executor-permissions`) and nothing is launched.
- The harness adapter states, for each tier, the permission mode and allow rules its executors run with. `hitld install` writes the allow rules the contract needs into the project's plugin settings, so an installed project's executors can run them.
- Until a project is installed, an owner-approved way to run an executor is named by the check, so the first items that build the installer are not blocked by it.
- An executor's report that shows refused commands is recorded as blocked by permissions, never as a missing report shape, and the item is not re-dispatched into the same refusal.
- The chief-of-staff and orchestrate skills say what to do when dispatch is held for this reason.
- Tests cover a refused launch, the rules `hitld install` writes, and a refused-commands report. Design part 15.4 says how.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session: the chief of staff files work for the system and does not execute it. HITLD-109 needs this. A way to run the first items that build this fix, before it exists, is the owner's call.
