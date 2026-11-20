---
id: HITLD-470
title: Revisit whether a run needs to exist apart from the ledger, now that orchestrators are disposable
kind: work
state: proposed
created: 2026-11-17
project: HITLD-15
---

## Done when

- The owner decides, in a walk-through one question at a time, whether the design still needs a **run** as its own object, or whether the ledger and the tracker alone can carry what a run carries today. The walk-through settles at least: what a run holds now (the checkpointed run state, the lease, the `run` field and run-scoped counters on ledger events, the owner hold that "a new run starts released", the per-run count of permission refusals, the hand-over note) and what each would become without a run; whether a successor orchestrator needs to "resume" anything or can rebuild from the ledger and tracker alone (design 13 already says state can be rebuilt from the ledger when a machine has none); what a person is shown instead of a date-and-number run ID (HITLD-466); and what happens to the open items that assume a run (HITLD-323, the hand-over limit, `hitld run start`, `run resume`, `handover`).
- The answers are written into the design (parts 2, 5 and 13 and the data model), and the items that build them are filed from the walk-through, each placed under a milestone. Items that only make sense with a run (such as HITLD-466, run names) are kept, changed or dropped to match.
- `hitld work check` passes.

## Why

The owner asked on 2026-11-17 why runs are needed. In the design a run is the durable container that lets a disposable orchestrator be replaced: the state a successor resumes, a lease so two orchestrators do not drive one run, and a scope on every ledger event. In the cloud setup used so far that persistence does not hold: a successor in a fresh container cannot resume (HITLD-323, seen twice), so in practice one orchestrator session is one run, started by hand and seeded with the next numbers. What remains visible is the cost (a date-string ID, a hand-written note, a seeded number series). The owner said the part of the design should be revisited to see whether it is still needed.

## Notes

Design-heavy: stays proposed and is walked through with the owner. Related: HITLD-323 (a successor cannot resume), HITLD-324 (a fresh run), HITLD-74 (numbering), HITLD-466 (run names), HITLD-427 (the owner hold lives in the run), HITLD-441 (deferral and emergent escalations). The answer may change what HITLD-190 c2 (a successor in a fresh container resumes) means.

## Decided so far (the owner, 2026-11-18, in a walk-through)

- **Continuity (HITLD-484):** the ledger and the tracker carry continuity between orchestrator sessions; there is no run object. A new orchestrator rebuilds from the ledgers and the tracker and GitHub. No lease, checkpoint or hand-over note: the chief of staff starts one orchestrator at a time.
- **Numbering (HITLD-489, replacing HITLD-485):** event and dispatch IDs are unique by construction: time-ordered random IDs that cannot collide across containers, one append-only file per writer, and the global ledger as the union of those files read through the local index. Display numbers are assigned when the index ingests them; trailers on main carry the unique short ID. Existing D-1 to D-38 stay as they are. HITLD-74's per-machine blocks, and orchestrator-numbered IDs (HITLD-485), are dropped: a machine is a new thing every time in the cloud, and orchestrator numbers depend on a disposable chief of staff session. Tracker IDs (HITLD-n) are a separate case: human-facing, from one counter in the store with a compare-and-swap push, as now.
- **Where the ledger goes (HITLD-486):** the private store, one file per writer (orchestrators and the chief of staff), pushed as it goes. Nothing merges. It needs the cloud store enrollment fixed (HITLD-323, HITLD-333), which a durable store needs anyway.
- **How global (HITLD-490):** each project keeps its own raw ledger in its own private store, so confidentiality stays per project. A person-level layer holds only the aggregates learning needs across projects (estimates, token ratios, trust calibration); no raw events cross projects.
- **The owner hold (HITLD-487):** with the chief of staff, passed on in each new orchestrator's start brief and by message to the live one, and recorded as the owner's decision in the tracker. This replaces the decision HITLD-427, which put it in the run.
- **Replacing an orchestrator (HITLD-488):** on measured context pressure only (today's share of 0.7). The completion count (`orchestrator.handover_after_completions`, 20) is dropped.

## Consequences to file (not yet filed)

- Replace HITLD-74 (per-machine blocks) with unique-by-construction IDs and per-writer ledger files, and reconcile nothing: the old ledgers stay as they are. Also build the person-level aggregate layer (HITLD-490) and fix the store enrollment so ledgers actually reach the store: today every cloud container's ledger stays in that container.
- Reshape HITLD-323 (a successor cannot resume) into the store enrollment fix and one file per orchestrator; Q2 to Q4 there fall away or change.
- Reword HITLD-190 c2 (a successor in a fresh container resumes from the store) to "a successor rebuilds from the store's ledger files and the tracker".
- HITLD-466 (run names) becomes orchestrator names or goes away.
- Build: remove `hitld run start`, `resume`, `handover` and the run state and lease (design 13 and the packaging doc), the `run.*` settings and `orchestrator.handover_after_completions`; the per-run counters (permission refusals, the owner hold) move to the orchestrator and the chief of staff.
- Skills and design: the chief-of-staff and orchestrate skills describe starting a numbered orchestrator from a brief, not a hand-over.

## Left the milestone on 2026-11-20 (HITLD-603)

This item left milestone HITLD-190; it closes when the design-docs update (HITLD-572) merges.
