---
id: HITLD-1062
title: The unreadable-record grace judges a half-written lock file by one clock, not by comparing the local clock with the file's modification time
kind: work
state: proposed
created: 2026-11-25
project: HITLD-15
needs: [HITLD-1051]
constraint_of: [HITLD-405 c?]
---

## Done when

- A design note settles what the grace compares: a monotonic read of when this process first saw the unreadable record, or the file's own written timestamp, instead of `abs(now - mtime) > 1 s` (`core/lib/env/lockcore.mjs`).
- A test: a file whose modification time comes from a clock more than 1 s away (a network file system, or a backward jump during the write) is still held for the grace, not taken over at once.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-1051 holds a record that cannot be read for 1 s judged against the file's modification time. On a file system whose times come from another clock with more than 1 s skew, a half-written file counts as stale at once and can be taken over.

## Notes

rc.3, proposed: a guess from the review, [Guessing] that it happens on a local disk; confirm on a network file system before spending an executor. Owner-held (merge-path lock).
