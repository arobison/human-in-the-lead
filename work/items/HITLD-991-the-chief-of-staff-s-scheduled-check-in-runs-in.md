---
id: HITLD-991
title: The chief of staff's scheduled check-in runs in a fresh session built from current state and wakes the chief of staff only when something needs action
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The check-in routine is created with a fresh session on each firing, and its prompt is generated from `run status` and the lease, so it never names a session that no longer holds the run; a test checks the prompt against a changed lease holder.
- The fresh session sends a message to the chief of staff only when there is a decision, a stalled executor or a gate change; with nothing to do it ends silently.
- `hitld:setup` offers the routine and the guide says how to retire it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The current routine runs in the chief of staff's own session, so every firing re-reads the whole context, and its stored text went stale (it still names a retired orchestrator). Serves the owner, who should hear about a check-in only when it matters.

## Notes

rc.3. From the owner's request of 2026-11-24 to keep the token use of the chief-of-staff chat down without breaking the long-running chat: one chief-of-staff session read billions of cache-read tokens in eight days, because every model call re-reads the whole context, so cost grows with context size times the number of calls.
