---
id: HITLD-491
title: A person-level layer holds learned figures across projects (estimates, token ratios, trust calibration), and no raw events cross projects
kind: work
state: planned
created: 2026-11-18
project: HITLD-15
needs: [HITLD-74]
---

## Done when

- A person-level layer holds only learned aggregates that learning needs across the owner's projects: the estimates by item kind and tier, token ratios (estimate against measured), and trust calibration. No raw ledger event, item text, decision text or private record crosses from one project's store to another or into this layer.
- The layer is rebuilt from each project's per-writer ledger files (HITLD-74) and is read by the planner's estimator and the trust record as a prior when a project has too little of its own history, and says where each figure came from (the layer or the project) the way HITLD-439 says where an estimate came from.
- A test shows two projects feeding the layer, the layer holding only aggregates, and a project with no history reading the layer's figure; another shows that a raw event never appears in the layer's files.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner decided on 2026-11-18 (HITLD-490) that the ledger is per project, so confidentiality stays per project, with a person-level layer of learned figures shared across projects. Each cloud container's ledger lives only in that container today, so the learning loop starts over each time (design 0003); this layer is the part that lets what is learned in one project help the next without mixing their records.

## Notes

Needs HITLD-74 (per-writer ledger files) and, to be useful in a cloud run, the store enrollment fix in HITLD-323. Code and design: the owner's own yes to merge. Related: HITLD-408 (learned parameters, token shares), HITLD-439 and HITLD-450 (estimates and where they came from).
