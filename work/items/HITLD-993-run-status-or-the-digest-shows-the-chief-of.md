---
id: HITLD-993
title: Run status or the digest shows the chief-of-staff session's context size and its cache-read tokens per day against a target
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-408 c?]
---

## Done when

- `hitld run status` or the digest shows, for the chief-of-staff session, its current context size and its cache-read tokens for the last day, read from the harness's session records, next to the policy's target; a test with a fixture record covers it.
- Policy holds the target as a number, and the digest says when the day exceeded it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Without a number the owner cannot tell whether a change to compaction or call counts helped. It uses the same session records as HITLD-585 (spend by role per session) and HITLD-139 (token accounting), which are in rc.4; this item is the small first slice for the chief-of-staff chat.

## Notes

rc.3. From the owner's request of 2026-11-24 to keep the token use of the chief-of-staff chat down without breaking the long-running chat: one chief-of-staff session read billions of cache-read tokens in eight days, because every model call re-reads the whole context, so cost grows with context size times the number of calls.
