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

## Analysis for the walk-through (chief of staff, 2026-11-16, for the owner's morning)

What the private store's remote holds today, read with the chief of staff's own access: only device requests (a few, from cloud devices, filed the evening before the run started) and nothing else: no approvals, no store files, no push from any approved device. A cloud device's key therefore asked to join and was never approved, so every push from it is refused with `device-not-enrolled`. The owner made no key changes. This is not a wrong environment: the cloud environment has the identity and remote variables set and both repositories attached. (Device and environment names are private and are left out of this public item.)

Why it never got approved (as the design reads, not fully verified): design 3, section 6 says only the owner's own answer enrolls a device, put to them as a decision by a device the owner already approved, and that the first device of an empty store asks the owner to approve its own key. Here no device was ever approved. A cloud device's request on its own, from a container that is discarded, has no approved device behind it to put the request to the owner. The first-device decision, if it was raised at all, was raised in a local store that died with its container.

Why it showed up late: nothing checks enrollment when a run starts. The run worked for about seven hours, 23 dispatches and 22 completions, with its state only in the first orchestrator's container, and failed at the first hand-over, the first time the state had to leave that container.

Options for the walk-through, one question at a time (none is decided):

- **Q1, the first device.** Where does the owner's first device come from? (a) The owner's own machine becomes the first device: `hitld store device init` there, the owner answers its decision, it pushes; then `hitld store device ask` puts the cloud requests to the owner. Needs no change, only the owner's machine and a written setup guide. (b) A cloud session may be the first device: the owner approves its own request in the same session, over chat, and the session pushes at once, before its container ends. Needs a change: the request must reach the owner as a question right away, and the first push must follow the answer.
- **Q2, a check at the start.** `hitld run start` and `hitld run resume` check this device's enrollment (`store status`) and refuse to go on, or warn the owner loudly, when a cloud run's device cannot push. Cheap, and it would have found this at the start, not at hour seven.
- **Q3, a fallback hand-over.** When the store cannot carry the hand-over, the orchestrator writes a short hand-over note and a ledger summary somewhere that survives (the tracker repository through the chief of staff, or the chat), so a successor can at least continue, as HITLD-188 asks for the chief of staff's own note.
- **Q4, the stalled run.** When no successor can resume, the run pauses cleanly with a note to the owner, not silently, and the planner and the hand-over limit do not strand the run.

Unblocking the run now (not design; the owner's action): on the owner's machine, `hitld store status`, then `hitld store device ask`; approve the cloud orchestrator's request; push once from the approved machine; then the orchestrator's pull finds the approval and its push works. Which request belongs to the cloud environment's key is not shown in what the chief of staff can read.
