---
id: HITLD-1009
title: A stale follow-up-pending record has a documented way out, and the error message names it
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The `follow-up-pending` error text names the command that clears a stale pending record, and the orchestrate skill and the guide say what it is and when it appears; a test covers a follow-up whose launch never ran, then the documented command, then a normal start.
- A launch that never ran (the orchestrator lost context between `follow-up` and the launch) is found by `hitld run status` or the watch, which lists the pending record with its age.
- The failed-launch message counts only the files it removed, not the files it looked for.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Pull request 600 (HITLD-935) refuses `dispatch start` for an item with a pending follow-up (`follow-up-pending`). The independent read on 2026-11-24 found that a record left by a follow-up whose launch never ran has no documented way out: the way out that worked was `dispatch handle --harness-ref <anything> --mode subagent` and then `dispatch complete`, or deleting the file by hand. Nothing in the skills or docs mentions the error. Accepted by the owner with this filed.

## Notes

rc.3. Cosmetic from the same read: the failed-launch message says 'removed 5 files' when some did not exist. The review also found no test that a different item still starts while one is pending, and none that a completed follow-up frees the item; add both.
