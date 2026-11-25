---
id: HITLD-1051
title: The machine locks decide through one pure function, and a model checker proves their invariants
kind: work
state: done
created: 2026-11-25
project: HITLD-15
needs: [HITLD-1050]
constraint_of: [HITLD-67 c?]
claimed_by: D-01M8A9WX985TN39E
---

## Done when

- A pure `decide(state, event)` in `core/lib/env/lockcore.mjs` makes every lock decision (grant, renew, queue order, release, reap); `core/lib/env/locks.mjs` is the I/O shell around it, and its behaviour is unchanged apart from the fixes below.
- An exhaustive explorer drives 3 actors over 2 resources through ask, ask again, release, crash, pid reuse, clock jumps either way and TTL ticks to a depth of about 12, on a fake clock, and asserts in every reachable state: the sum of live weights never exceeds capacity; no waiter waits only on a holder that is itself waiting; no wait-for cycle; a waiter that is first in line is admitted as soon as capacity frees; release is idempotent and never removes another holder's record.
- The failures found in the review replay as fixed traces and fail on the pre-change code: holder re-ask, same name from two processes, a release that removes a new holder's record, a half-written lock taken over, a backward clock jump reordering the queue, and a waiter's first attempt taking no ticket so a newcomer barges in. Tickets are ordered by a counter that never goes backwards (the larger of now and the last ticket plus one), and a waiter's first ticket is written before its first attempt.
- Each of those traces also runs through the real file-system shell and gives the same result, so the model cannot pass while the code fails.
- Renewal and release are decided inside the resource's one critical section (the existing `.admit` mutex, used for the single lock too), and record writes go through a temporary file and an atomic rename; the first creation of the single lock stays an exclusive create so rc.1 copies are still excluded.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 656 (a holder that asks again stalls every waiter until the lock's TTL expires; seven executors across two projects stalled, as reported) and the owner's 2026-11-25 ask for a deterministic way to acquire and release machine locks, built on operating-system and threading concepts. A read-only design review of core/lib/env/locks.mjs found, with reproductions: the holder re-ask stall; two processes using the same holder name both get in, and a release by either frees the lock for both (the merge queue always uses the name `merge-queue`); a live holder loses its lock when its TTL passes, for example when the merge gate's `spawnSync` blocks the timer that renews it; renewal and release read and then write with no mutex; a lock file read half-written is taken over; tickets are ordered by the wall clock, so a backward jump reorders the queue; a waiter has no ticket on its first attempt, so a newcomer can barge in.

## Notes

Second of three lock items (HITLD-1050, this, HITLD-1052). Needs HITLD-1050 merged first (same file). Design from a read-only review on 2026-11-25; the new fields are additive and the paths `.lock`, `.holders/`, `.queue/` and `.admit` stay, so rc.1 and rc.2 copies still exclude each other, but an rc.1 copy keeps its own stall and TTL failures: `env status` should say so (HITLD-1052). Do not move capacity-1 resources into `.holders/` in rc.2; that would break exclusion with rc.1. Ordinary code, reviewed independently before merge.
