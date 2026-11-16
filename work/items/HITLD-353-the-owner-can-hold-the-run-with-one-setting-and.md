---
id: HITLD-353
title: The owner can hold the run with one setting, and the planner offers nothing until it is released
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Done when




- One owner setting (or one command that writes it) holds the run: while it is set, `dispatch plan` and `ready` offer no item to start, say it is held by the owner and since when, and a running executor is not stopped. Releasing it is the same one step.
- The hold is distinct from the quota gate's own pause: the gate sets and lifts its pause by itself, and the owner's hold is never lifted by the gate. The plan shows both when both apply.
- The orchestrate skill and design 12 say who may set it (the owner, through the chief of staff) and that an orchestrator obeys it before any other rule. Tests cover set, release, and a hold set while an executor runs.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-16 the owner held the run several times by instruction: the large eval item (HITLD-52), the self-host install (HITLD-109) and, after the gate began letting next-ranked items through as critical path, HITLD-143 and HITLD-145. Each time the chief of staff added a `needs` edge to one item (HITLD-349, HITLD-351) or the orchestrator idled by instruction, and the scheduler then offered the next-ranked item. There is no supported way for the owner to say "start nothing": the orchestrator reported that `paused` is set only by the gate itself.

## Notes

Needs a design choice on where the setting lives (policy or the run state) and what the plan prints, put to the owner in a walk-through. The usage gate letting the next-ranked items through as critical path in critical_path_only mode is a related finding: whether the gate should offer any item when no item is truly urgent belongs in the same walk-through. Code, skill and policy: the owner's own yes to merge.
