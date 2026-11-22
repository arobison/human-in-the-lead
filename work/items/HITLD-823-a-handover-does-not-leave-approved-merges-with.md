---
id: HITLD-823
title: A handover does not leave approved merges with no orchestrator to apply them
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---


## Why

Orch-6 handed over at its eighth completion (the owner's rule, HITLD-794) while four approved pull requests were still waiting. After a handover the old orchestrator can record nothing, so `hitld merge` could not be run until the same session resumed the lease on the owner's say, outside the rule. Nothing warned that merges were pending.

## Done when

- `hitld handover` names every approved or presented pull request still waiting and either refuses until a merge pass has run or writes them into the handover note's first lines; a successor's `run resume` shows them first.
- Merge-only passes (no starts) are allowed to the handing-over session for the pull requests named at handover.
- Tests cover a handover with approved merges pending, with none, and a merge-only pass after it. A skill and run change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
