---
id: HITLD-1050
title: A lock holder that asks again for its own lock renews it at once, even when others are queued
kind: work
state: proposed
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when

- `acquireLock` (core/lib/env/locks.mjs) checks, before the queue logic, whether the caller already holds the resource (the single lock, or a weighted holder record), and if so renews it and returns at once, whether or not other holders are queued; a holder's repeat request never takes a ticket behind waiters that are waiting on that same holder.
- A test fails on current main and passes after: holder A holds a resource, holder B waits for it, A asks again with wait; A's request returns renewed at once and B stays queued. The same test runs for a resource with capacity above 1.
- The doc comment on `acquireLock` ("a holder that asks for a lock it already holds renews it") is true for every call, queued waiters or not.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reported from another project's production use of an earlier release: one executor's gate asked again, from the same shell, for a lock it already held (the cpu-heavy resource) while other executors waited for it. Only the first ticket in the queue may try, so the holder's second request took a ticket at the back, the waiters ahead of it waited on the holder, and nothing moved until the TTL expired; seven executors across two projects stalled. On current main `acquireLock` still lets only the first ticket try (the `myTurn` check), so the same stall is likely here. [Likely: from reading the code, not yet reproduced; the reproducing test is the first step.] Serves the owner, who loses a whole fleet's time to one repeated request.

## Notes

Filed by the chief of staff, 2026-11-25, as `proposed`; the owner placed it in rc.2 the same day and asked for a more deterministic lock protocol, so the scope is being widened (design under way). Reported by the chief of staff of another project that runs HITLd and keeps a local patch until a release has the fix; its suggested fix (check for an existing hold before the queue logic and renew) is the direction, to be built against main's weighted-capacity code (HITLD-41), which that report predates. Nearby: GitHub issues 635 and 604. A second request in the same report, counted locks with a benchmark that runs alone, is already built in part by HITLD-41 (weighted capacity) and the rest is HITLD-559 (a performance run takes the machine); it is not filed again. Ordinary code, reviewed independently before merge.
