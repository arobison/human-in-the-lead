---
id: HITLD-989
title: "One hitld command does each repeated chief-of-staff flow: approve a merge (store pull, approve, store push) and merge a tracker-only pull request after its checks"
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `hitld merge approve --push` pulls the store first, records the approval and pushes the store after, and prints one result; a test covers the three steps and a refusal at each.
- `hitld merge --tracker-only <pr>` verifies the head, the file list under `work/` only, the checks and the head branch's origin, merges with the trailers, and prints one result (the security review's T6); a test covers a code file, a failed check and a moved head.
- The chief-of-staff skill uses the commands instead of the multi-call sequences.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Each flow takes five or six model calls today, and each call re-reads the whole context. Serves the owner's token budget and the safety of the tracker-only merge (HITLD-871).

## Notes

rc.3. From the owner's request of 2026-11-24 to keep the token use of the chief-of-staff chat down without breaking the long-running chat: one chief-of-staff session read billions of cache-read tokens in eight days, because every model call re-reads the whole context, so cost grows with context size times the number of calls.
