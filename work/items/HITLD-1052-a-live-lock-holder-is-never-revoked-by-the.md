---
id: HITLD-1052
title: "A live lock holder is never revoked by the clock: owner identity, liveness, release by token, backoff and signal handlers; the merge queue's holder name is unique per run"
kind: work
state: in-progress
created: 2026-11-25
project: HITLD-15
needs: [HITLD-1051]
constraint_of: [HITLD-67 c?]
claimed_by: D-01M8AF3VD9RNKH04
---

## Done when

- Each holder is identified by its name plus process id, process start time and boot time, and each grant carries a random token; a re-ask by the same name and identity renews, a different identity under the same name is refused. Tickets carry the waiter's process start time, so a reused pid cannot hold the head of the queue.
- A holder whose identity can be verified alive is never revoked when its expiry passes; the expiry applies only when liveness cannot be judged (another host, or no start time). A holder that is hung but alive is ended by an explicit logged `hitld env unlock --force` or by the dispatch watchdog. A test: a holder blocked past its expiry in a synchronous child process keeps the lock. `lock_expiry_seconds` is described as the limit for holders whose liveness cannot be checked.
- Release is matched by token inside the critical section and is idempotent: a stale handle, or a second release, removes nothing of a new holder's. The CLI's lock path releases on exit, SIGINT and SIGTERM before the signal is re-raised, and a kill -9 is reclaimed by the next waiter within the poll limit.
- Waiters poll with backoff from 50 ms to 1 s with jitter, with `fs.watch` on the locks directory as a hint only; every wake-up re-checks the full state. A waiter takes a timeout and an abort signal, and ending either way removes its ticket. The `ps` liveness probe is cached so a CLI lock does not make the head waiter spawn it about 20 times a second.
- `env status` shows each holder's identity, age, last renewal and any wait, and flags records and tickets written by an rc.1 copy (no version marker) and names the outdated copy on PATH.
- The orchestrator's merge queue holds its lock under a name unique to the run, takes it inside the `try` that releases it, and releases it on every exit.
- Multi-process tests, synchronised with barrier files and not sleeps, assert: an executor asking again while others queue renews at once; two processes with one name are refused; kill -9 of a holder admits the next waiter; a stale handle's release leaves the new holder in place; N processes hammering a capacity-4 resource never record weights above 4 (read from an append-only grant and release log); an rc.1-format record and ticket are respected.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 656 (a holder that asks again stalls every waiter until the lock's TTL expires; seven executors across two projects stalled, as reported) and the owner's 2026-11-25 ask for a deterministic way to acquire and release machine locks, built on operating-system and threading concepts. A read-only design review of core/lib/env/locks.mjs found, with reproductions: the holder re-ask stall; two processes using the same holder name both get in, and a release by either frees the lock for both (the merge queue always uses the name `merge-queue`); a live holder loses its lock when its TTL passes, for example when the merge gate's `spawnSync` blocks the timer that renews it; renewal and release read and then write with no mutex; a lock file read half-written is taken over; tickets are ordered by the wall clock, so a backward jump reorders the queue; a waiter has no ticket on its first attempt, so a newcomer can barge in.

## Notes

Third of three lock items (HITLD-1050, HITLD-1051, this). Needs HITLD-1051 merged. OWNER-HELD: it changes what `lock_expiry_seconds` means (policy and public-schema wording), the CLI's interface, the merge path's lock use, and probably a skill line. Known risks, from the design review: a hung but live holder now holds until forced (if hangs prove commoner than crashes, add fencing tokens and a lease the holder must keep renewing); mixed rc.1 and rc.2 copies keep rc.1's failures, so the release notes should say to upgrade every copy on PATH; liveness is still a judgement (`ps` start time has one-second resolution), and if the model checker shows the mutex double-break at `core/lib/env/mutex.mjs` can admit two holders, move liveness to a listening Unix-socket beacon. Left out on purpose: ordered multi-resource acquire (`acquireAll`, `withLock`) for GitHub issues 635 and 637, merge-gate priority over executors' heavy jobs (issue 604), and the benchmark gate (HITLD-559); all are rc.3. The quiet-machine predicate (HITLD-1013) composes with this: the head waiter evaluates it after reserving the machine, with its own bounded wait that releases the reservation.

The HITLD-1051 reviews add two things for this item: two callers in one process under one holder name are renewed, not refused, so one handle's release removes the other's hold (decide whether a name is unique per process or per handle); and the `env lock` JSON should carry a `renewed` field (owner's answer, 2026-11-25: not in rc.2's 1050, with this item). The ghost-ticket case (a dead waiter's pid reused, so it holds the head of the queue) is in this item's scope: tickets need a start time.
