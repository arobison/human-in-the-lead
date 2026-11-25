---
id: HITLD-983
title: A job can request a quiet machine, and the orchestrator grants a timed quiet window so quiet-only work neither waits forever nor starves other work
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-71 c?]
---

## Done when

- `hitld run quiet request` records who asks, why, the load per core it needs and how long it waits; a test covers the record.
- The orchestrator can grant a window with a timeout, and `hitld run quiet status` tells an executor whether a window is pending or active; a test covers both states.
- A request gains priority the longer it waits and policy caps how long and how often windows run; a test covers both limits.
- Run status and the digest show a pending or active window and what it held.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Work that only means something on a quiet machine, such as a cold-start timing check, can wait forever while executors keep starting heavy work, and a merge held behind it blocks follow-up work. It serves the orchestrator and the owner who holds merges on those checks.

## Notes

GitHub issue 428. rc.3. The tool side is HITLD-559 (heavy steps hold weighted machine capacity); this is the orchestrator side that makes the machine quiet.

GitHub issues 668 and 669 (2026-11-25) also ask for a machine-wide quiet shared across projects on the same machine, not only per project; the machine-level half is HITLD-559.
