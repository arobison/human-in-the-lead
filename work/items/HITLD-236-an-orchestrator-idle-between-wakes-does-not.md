---
id: HITLD-236
title: An orchestrator idle between wakes does not lose its lease, so the chief of staff does not start a successor over it
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

With the default `run.lease_expiry_seconds` of 1800, and the lease renewed only at checkpoints or ledger writes, an orchestrator that is idle between wakes for more than 30 minutes shows `lease.free: true` in `hitld run status` (`core/lib/run/run.mjs` lines 355 to 367, `leaseStatus`: free is released or expired). Step 2.2 of the chief-of-staff skill then starts a successor, so a healthy but idle orchestrator can be replaced. The first self-hosted orchestrator avoided this only because it ran `run checkpoint` at the end of every turn. Reproduce: `run start`, then `run status` with the clock 1801 seconds later (the watchdog test fixture's `c.at(1801)`). Unverified beyond the executor's reading of the code.

## Done when

- An orchestrator that is waiting for a wake, and has said so in its last message, does not show a free lease until a limit that covers its expected wake interval; or the lease is renewed whenever the orchestrator is woken or sends a message (HITLD-144's `run woke` and `run heard` give the events).
- The chief-of-staff skill's successor rule says what it checks before starting a successor, so a silent but alive orchestrator is woken first.
- A test runs the case above and checks that no successor is proposed.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by D-17 in its `found` section; relayed by orch-1 and filed under HITLD-181. Related to HITLD-144 (PR #182).
