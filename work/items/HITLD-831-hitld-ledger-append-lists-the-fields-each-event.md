---
id: HITLD-831
title: `hitld ledger append` lists the fields each event takes, and an unknown field is refused with the allowed list
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---


## Why

On 2026-11-22 the orchestrator's `hitld ledger append` for a merged event was refused for a `via` field; the message did not list the fields a merged event may carry (event, item, dispatch, branch, commit, notes, corrects), so the orchestrator found them by trial.

## Done when

- The refusal names the event kind and lists its allowed fields; `hitld ledger append --help` lists each event kind's fields.
- A test covers an unknown field on a merged event. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
