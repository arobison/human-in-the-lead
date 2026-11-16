---
id: HITLD-323
title: "A successor orchestrator in a fresh cloud container cannot resume: the run state and hand-over note do not travel when the store sync is refused"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Found on 2026-11-16 in the first cloud self-hosting run. The orchestrator (orch-1) reached its hand-over limit (22 completions, limit 20) and released its lease. The chief of staff started a successor in a fresh cloud container. It ran `hitld run resume --live none` and got: `no run state (run-state.json is missing); run hitld run rebuild`. The run state, the ledger, the usage snapshots, the person settings and the hand-over note all live only in the first orchestrator's container. The hand-over's store push failed with `device-not-enrolled`, because that device's key had not been approved, so nothing travelled. The successor correctly stopped and started nothing.

So the design's hand-over (a successor takes over from the store) does not work in a cloud run until the store sync works, and the run stalls at its first hand-over, as it did overnight. Related: HITLD-142 (a cloud orchestrator session can reach the private store), HITLD-148 (a cloud session starts with the owner's settings and nothing carried by hand), HITLD-188 (the chief of staff's hand-over note), HITLD-236 (an idle orchestrator keeps its lease).

## Done when

- A hand-over in a cloud run either reaches the next session or says plainly, before the limit is reached, that it cannot, and what the owner must do (for example approve the device) so the owner can fix it before it stalls the run.
- A fresh container can resume: the state it needs (checkpoint, ledger summary, usage, person settings, open decisions) is carried by a channel that works without hand-copying, or `hitld run resume` says exactly what is missing and how to restore it.
- The hand-over limit does not strand a run: when no successor can resume, the run keeps going or pauses cleanly with a note to the owner, not silently.
- A test or eval covers a hand-over in a fresh checkout and the refused-sync case.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The owner's decision to reconcile the stores after HITLD-74 stands; this item does not change it. Approving the device key is the owner's action, not an agent's.

## Analysis for the walk-through (chief of staff, corrected 2026-11-16)

**Correction.** An earlier version of this section said the cloud device was never approved. That was wrong: it rested on a partial view of the store's remote. Read from the chief of staff's own container, with `hitld store status` and `hitld store device list`: this environment's device is approved (it is the one approved device), it is enrolled, its key opens the remote, the remote holds pushed versions, and `sync.ready` is true. The store works from the chief of staff's container.

**What failed, as best it can be read (the first orchestrator's container was not inspected, so [Likely], not verified).** The first orchestrator was told not to pull or push the store, by the owner's decision to reconcile the stores only after HITLD-74 (per-machine ID blocks, so two containers' ledger and dispatch IDs do not collide). So its local copy never took in the approval that lives on the remote. Its hand-over push was therefore refused as `device-not-enrolled`, `hitld handover` had already released the lease, and the successor in a fresh container found no run state.

**Design flaws this shows.**
- The hand-over depends on the store carrying the run state, but two cloud containers cannot merge their ledgers until HITLD-74 exists, and a run can start in a container that deliberately never syncs. Nothing says so at run start.
- Nothing checks at `run start` or `run resume` that the store is ready for a hand-over (a remote with no local pull looks like a clean start).
- `hitld handover` releases the lease before it knows its push can land, so a failed push strands the run.
- Checkpoint pushes that fail with `device-not-enrolled` are reported as non-blocking failures, so a run can work for hours without any state leaving its container.
- `store device init --cloud`, run without the identity variable set, mints a new key and prints its private key into the session, which can leave extra requests on the remote.
- Even a working store would not carry usage snapshots or person settings: usage is machine-local, and moving person settings is HITLD-148.

**Recommended small changes, none a design change of substance (from an independent review, to confirm in the walk-through):** a preflight at `run start` and `run resume` (store ready, and whether this container has pulled); `hitld handover` checks that its push can land before it releases the lease; a checkpoint marks a `device-not-enrolled` push as blocking; `init --cloud` never mints a key inside a session; an offline fingerprint command; a setup guide that covers the cloud-only first device.

**Questions for the walk-through, one at a time (none decided):**
- **Q1, when to reconcile.** Reconcile the first orchestrator's store with the remote now (a pull merges the ledgers, and a conflict stops it with nothing merged), or wait for HITLD-74 as decided and accept that the run's hand-over cannot carry state until then?
- **Q2, the preflight.** Should `run start` and `run resume` refuse, or warn loudly, when the store is not ready for a hand-over?
- **Q3, the hand-over order.** Should `handover` check that its push can land before releasing the lease?
- **Q4, the stalled run.** When no successor can resume, should the run pause cleanly with a note to the owner and the hand-over limit not strand it?
