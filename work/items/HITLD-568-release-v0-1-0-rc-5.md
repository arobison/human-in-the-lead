---
id: HITLD-568
title: Release v0.1.0-rc.5
kind: work
state: planned
created: 2026-11-19
project: HITLD-15
release: 0.1.0-rc.5
needs: [HITLD-401, HITLD-566, HITLD-567, HITLD-407, HITLD-409]
---

## Why

The fifth release candidate is the system earning trust: the stage the owner added before v0.1.0 (decision HITLD-551), after the design walk-throughs of 2026-11-19. It follows v0.1.0-rc.4 (HITLD-401) and waits for two new milestones, the system earns trust (HITLD-566) and work is paced to the plan (HITLD-567), and for the milestones on answers and proof (HITLD-407, HITLD-409).

## Done when

- Release v0.1.0-rc.4 (HITLD-401) is made, and the four milestones this item needs are done, each by its own check.
- The gate: `hitld release propose --pre rc` (which finds this item by its `release` key) reports no gates and no missing release notes.
- The committed offline eval baseline is from a clean run of the final main.
- The release is made through the release pull request, as for rc.4: `hitld release make --pre rc --branch release/v0.1.0-rc.5` in the owner's turn, merged with the owner's sign-off, the `release` environment approved, the draft published.
- Self-hosting moves its pin to v0.1.0-rc.5 by a pull request the owner merges, following `hitld upgrade plan`.

## Notes

Made by the chief of staff on the owner's decision HITLD-551; the scope is a proposal for the owner to amend. The milestones HITLD-407 and HITLD-409 (answers and proof) were under no release before.
