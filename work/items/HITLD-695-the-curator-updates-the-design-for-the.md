---
id: HITLD-695
title: The curator updates the design for the extensible work-tracking views
kind: work
state: planned
created: 2026-11-21
project: HITLD-15
---

## Why

The extensible work-tracking views were decided in a walk-through (HITLD-681, decisions HITLD-682 to 689) and need the design text to say so before they are built, marked decided and not built. The owner's rule: docs/ changes only through a curator job and a design pull request for the owner's yes.

## Done when

- A curator job drafts the design changes: part 12 (the dashboard page and its data contract, 12.1.3 and 12.4) and part 16 (the files the commands write and read, including `views.json`) say how a project adds panels and evidence panels, with the closed set of panel types, the label rule, no code from projects, no cross-project view, and regeneration on events; each is marked decided, not built, until its build item lands.
- The design pull request is the owner's to merge, with the changes listed for the owner's yes.
- `hitld work check` passes.
