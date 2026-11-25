---
id: HITLD-1045
title: The ledger records how long each dispatch took and how long the owner took to answer, and the ready queue's wall-time path uses them
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
needs: [HITLD-995]
constraint_of: [HITLD-67 c?]
---

## Done when

- The ledger's dispatch events carry enough timestamps that dispatched-to-reported spans are read per size tier (the sizing history reads them today as no duration); a test covers a dispatch with its spans and one without.
- The owner's median answer latency is derived from each answered decision's `answered_at` minus its ask time, and every owner decision on a path adds it to that path's remaining wall time; a test covers a path with two owner decisions.
- The queue's wall-time path converts estimated tokens to time with the per-tier rate from the ledger, and falls back to tokens alone when there is no history; a test covers both.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Wall time is the longest remaining path, and owner answers are its long pole. Without durations the queue can weigh tokens but not time, so it cannot choose between a long cheap path and a short expensive one.

## Notes

rc.2, the owner's word (2026-11-25): everything in the planner design rides rc.2. Follows HITLD-995. The ledger schema change is a public-schema surface: the owner's own yes at merge.
