---
id: HITLD-492
title: "The run object is removed: an orchestrator rebuilds from the store's ledger files and the tracker, and is replaced on measured context pressure only"
kind: work
state: planned
created: 2026-11-18
project: HITLD-15
needs: [HITLD-74, HITLD-323]
---

## Done when

- There is no run object. The run state file, the lease, the checkpoint and the hand-over note, and the commands that exist only for them (`hitld run start`, `run resume`, `run checkpoint`, `handover`, `run retire`) are removed or replaced by one command by which an orchestrator begins a session by rebuilding its view from the store's ledger files (HITLD-74), the tracker and GitHub. The name of that command is chosen in the build.
- The settings that only served the run are removed: the `run.*` settings (lease expiry, checkpoints kept) and `orchestrator.handover_after_completions` (the completion count, dropped by the owner in HITLD-488). An orchestrator is replaced when its measured context passes `orchestrator.handover_context_share` and not otherwise.
- The per-run counters move to where they belong: permission refusals are counted per orchestrator session, and the owner hold is kept by the chief of staff and recorded in the orchestrator's own ledger when told (HITLD-487, HITLD-353).
- The chief-of-staff and orchestrate skills, and design parts 2, 5 and 13, the data model and the packaging doc, describe starting an orchestrator from a brief (carrying the owner hold and the settings it needs) and replacing it on context pressure, with no hand-over. The plugin copies match.
- Existing ledgers stay readable: a ledger written with a `run` field still reads, and `D-1` to `D-38` keep their meaning in trailers on main.
- A test starts an orchestrator in a fresh checkout from the store's ledger files and the tracker with no run state, and one covers the replaced counters. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner decided in a walk-through on 2026-11-18 (HITLD-470; HITLD-484 to HITLD-490) that the run object is not needed: the ledger and the tracker carry continuity between orchestrator sessions, the chief of staff starts one orchestrator at a time, the ledger is one file per writer in the private store, and an orchestrator is replaced on measured context pressure only. In the cloud a successor could not resume the run in a fresh container (HITLD-323, seen twice), so in practice one orchestrator session was one run, started by hand and seeded with numbers.

## Notes

Needs HITLD-74 (unique-by-construction IDs and per-writer files) and HITLD-323 (the store enrollment, so ledgers reach the store). Code, skill, schema and design: the owner's own yes to merge. Related: HITLD-190 c2, HITLD-353 (the owner hold), HITLD-466 (names), HITLD-470 (the decision).
