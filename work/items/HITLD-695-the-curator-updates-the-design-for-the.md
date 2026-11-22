---
id: HITLD-695
title: The curator updates the design for the extensible work-tracking views and the shared React app
kind: work
state: planned
created: 2026-11-21
project: HITLD-15
constraint_of: [HITLD-67 c4]
---

## Why

The extensible work-tracking views were decided in a walk-through (HITLD-681, decisions HITLD-682 to 689) and need the design text to say so before they are built, marked decided and not built. The owner's rule: docs/ changes only through a curator job and a design pull request for the owner's yes.

Reworded for the shared UI kit (HITLD-720, 721, 724 to 728): the owner replaced the static page and regeneration design of HITLD-689 with one React app and component set, installed with HITLD, whose committed static bundle has the contract data inlined. The design text records that design, not the old one. The design item for the kit is HITLD-723; this item's text and HITLD-723's may land in one curator job.

## Done when

- A curator job drafts the design changes: part 12 (the dashboard page and its data contract, 12.1.3 and 12.4) and part 16 (the files the commands write and read, including `views.json`) say how a project adds panels and evidence panels, with the closed set of panel types, the label rule, no code from projects, and no cross-project view.
- The same changes record the shared UI kit: one React app and component set for HITLD's page and every project, with a typed client and React hooks for a project's own app (HITLD-720, 721); delivery installed with HITLD, with an eject command as a later item (HITLD-724); the page as a static bundle with the contract data inlined, regenerated on events and on demand, with an artifact as the chief of staff's viewer only (HITLD-725); a project's custom panels living in that project's own app, not in HITLD's build (HITLD-726); and the built bundle committed with a CI check that fails when it does not match the source, React and the bundler being development dependencies only (HITLD-727).
- The text states that these decisions revise HITLD-689 (a static, self-contained file regenerated on events) and says what of it stands: regeneration on events and on demand, and the statement of when and where the data was read.
- Each change is marked decided, not built, until its build item lands (HITLD-693, 694, 729); what HITLD-691 and 692 built is described as built.
- The design pull request is the owner's to merge, with the changes listed for the owner's yes.
- `hitld work check` passes.
