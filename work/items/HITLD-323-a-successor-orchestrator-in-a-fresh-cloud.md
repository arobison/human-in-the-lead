---
id: HITLD-323
title: "A successor orchestrator in a fresh cloud container cannot resume: the run state and hand-over note do not travel when the store sync is refused"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-148]
---

## Why

Found on 2026-11-16 in the first cloud self-hosting run. The orchestrator (orch-1) reached its hand-over limit (22 completions, limit 20) and released its lease. The chief of staff started a successor in a fresh cloud container. It ran `hitld run resume --live none` and got: `no run state (run-state.json is missing); run hitld run rebuild`. The run state, the ledger, the usage snapshots, the person settings and the hand-over note all live only in the first orchestrator's container. The hand-over's store push failed with `device-not-enrolled`, because that device's key had not been approved, so nothing travelled. The successor correctly stopped and started nothing.

So the design's hand-over (a successor takes over from the store) does not work in a cloud run until the store sync works, and the run stalls at its first hand-over, as it did overnight. Related: HITLD-142 (a cloud orchestrator session can reach the private store), HITLD-148 (a cloud session starts with the owner's settings and nothing carried by hand), HITLD-188 (the chief of staff's hand-over note), HITLD-236 (an idle orchestrator keeps its lease).

## Done when

**Reshaped on 2026-11-18** by the owner's decisions HITLD-484 to HITLD-490: there is no run object, so a successor does not resume a run; it rebuilds from the store's per-writer ledger files (HITLD-74) and the tracker (HITLD-492). What is left of this item is making the store carry them from a cloud container.

- A cloud container's device is enrolled in the store so its pushes of its ledger file and settings land: an approved cloud environment does not meet `device-not-enrolled`. Enrollment of a cloud device works without hand-copying keys, and an executor cannot enroll one.
- A push refused with `device-not-enrolled` warns the owner once, early, and again whenever an orchestrator is replaced; it does not block dispatch (HITLD-331, kept).
- A test covers a cloud container pushing its ledger file to the store and a fresh container pulling it and rebuilding an orchestrator's view from it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

**Superseded by the no-run decision:** the run-command refusals and hand-over order from the 2026-11-16 answers HITLD-329 (`run start` and `run resume` refusing without a store that can carry a hand-over), HITLD-330 (`handover` checking its push before releasing the lease) and HITLD-332 (a stalled-run pause), since those commands go with the run object (HITLD-492). A hand-over note is no longer needed.

## Analysis for the walk-through (chief of staff, corrected 2026-11-16)

**Correction.** An earlier version of this section said the cloud device was never approved. That was wrong: it rested on a partial view of the store's remote. Read from the chief of staff's own container, with `hitld store status` and `hitld store device list`: this environment's device is approved (it is the one approved device), it is enrolled, its key opens the remote, the remote holds pushed versions, and `sync.ready` is true. The store works from the chief of staff's container.

**What failed (confirmed by the first orchestrator's own read-only report from its container).** Its local store copy is a clone made when the repository was attached. It holds only the device requests and no approval, has never pulled or pushed through the sync (no sync state file), and its one attempted `hitld store pull` stopped on a ledger conflict: the same ledger event ID differs between that container's ledger and the remote's (two containers each numbered their own events, which is what HITLD-74 fixes). Because the pull stopped with nothing merged, the approval that the remote holds never reached that copy. Its hand-over push was therefore refused as `device-not-enrolled`, and a push from that copy would also have overwritten the remote's newer version with one that is behind it, so it must not be tried. `hitld handover` had already released the lease, and the successor in a fresh container found no run state. The owner's decision to reconcile the stores only after HITLD-74 stands; this item does not change it.

**Design flaws this shows.**
- The hand-over depends on the store carrying the run state, but two cloud containers cannot merge their ledgers until HITLD-74 exists, and a run can start in a container that deliberately never syncs. Nothing says so at run start.
- Nothing checks at `run start` or `run resume` that the store is ready for a hand-over (a remote with no local pull looks like a clean start).
- `hitld handover` releases the lease before it knows its push can land, so a failed push strands the run.
- Checkpoint pushes that fail with `device-not-enrolled` are reported as non-blocking failures, so a run can work for hours without any state leaving its container.
- `store device init --cloud`, run without the identity variable set, mints a new key and prints its private key into the session, which can leave extra requests on the remote.
- Even a working store would not carry usage snapshots or person settings: usage is machine-local, and moving person settings is HITLD-148.

**Recommended small changes, none a design change of substance (from an independent review, to confirm in the walk-through):** a preflight at `run start` and `run resume` (store ready, and whether this container has pulled); `hitld handover` checks that its push can land before it releases the lease; a checkpoint marks a `device-not-enrolled` push as blocking; `init --cloud` never mints a key inside a session; an offline fingerprint command; a setup guide that covers the cloud-only first device.

**Questions for the walk-through (Q1 decided as a fresh run, HITLD-324; Q2 to Q4 decided as listed in Done when):**
- **Q1, when to reconcile.** Reconcile the first orchestrator's store with the remote now (a pull merges the ledgers, and a conflict stops it with nothing merged), or wait for HITLD-74 as decided and accept that the run's hand-over cannot carry state until then?
- **Q2, the preflight.** Should `run start` and `run resume` refuse, or warn loudly, when the store is not ready for a hand-over?
- **Q3, the hand-over order.** Should `handover` check that its push can land before releasing the lease?
- **Q4, the stalled run.** When no successor can resume, should the run pause cleanly with a note to the owner and the hand-over limit not strand it?

**Second sighting (2026-11-17, the current orchestrator).** Asked to prepare a hand-over, the orchestrator reported the same consequences from its own container: its run state, ledger, usage snapshots, settings and the hand-over note live only in that container; every checkpoint and merge push of the private store failed with `device-not-enrolled`; so a successor in a fresh container cannot resume and `hitld handover` would release the lease before its push is known to land. It is handled by hand again (a text note, and the successor starts a new run seeded from the last run's numbers), as decided in HITLD-324. The chief of staff had told the owner a successor would resume the same run; that holds by the design but not here. Evidence only; the decisions Q2 to Q4 are still to be made in the walk-through.
