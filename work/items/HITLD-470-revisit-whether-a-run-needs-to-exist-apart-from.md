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
