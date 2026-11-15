---
id: HITLD-90
title: "Tracker structure: opportunities are projects being shaped, initiatives retire into milestones, one milestone kind"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-90
release_note: "The tracker loses two levels: a proposed project carries the shaping fields and the appetite, initiatives become milestones with no project, and milestones have one kind. `hitld work migrate` (tracker-structure) moves an existing tracker; old kinds are read with a warning. The tracker read API is version 3."
---

## Why

The tracker has more levels than one owner directing agents needs. This repository writes one outcome three times: initiative HITLD-1, project HITLD-28 and milestone HITLD-68. An opportunity is a project being shaped, kept as a second entity with its own states and a conversion step. Milestone kinds borrow SAFe's "capability", which already means harness capabilities here. The owner decided these changes before the first release, after the rename pass (HITLD-82).

## Done when

- **Opportunities are projects being shaped.** A proposed project carries the shaping fields (problem, evidence, options, value, confidence, cost of delay, `appetite_tokens`, `out_of_scope`, `risks`, signals). The owner's bet moves it from proposed to planned; a rejected one is dropped with a reason. The opportunity schema retires, and `bet_by` is derived from the decision, which is named `decision`.
- **The project holds the appetite.** Its milestones hold shares of it, and `work check` verifies the shares fit.
- **Initiatives retire.** A long outcome is a milestone with no parent whose constraints are other milestones; a project's parent is optional. The migration turns each initiative into a top-level milestone.
- **One milestone kind.** Milestones have `kind: milestone`; a learning milestone is the one whose check is a study, derived, not stored.
- **External items** are defined as work someone the system cannot dispatch completes: the owner by hand, a contributor, an upstream project, a vendor.
- **Small additions:** `work check` refuses numbered milestone names (M1, v2, phase 3); the project schema has `plan`; a record's `owner` is optional and defaults to the owner; an eval scenario checks agents never treat a judgment as settling a call.
- One registered `work migrate` step moves this repository's tracker in a reviewable commit; old kinds are read with a warning for one minor version; design parts 2 and 3 and the glossary describe the model as built.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The duplicated outcome (HITLD-1, HITLD-28, HITLD-68) is a tracker cleanup proposed to the owner separately, after this lands.

