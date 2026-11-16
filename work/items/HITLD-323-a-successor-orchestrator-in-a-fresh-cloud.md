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

