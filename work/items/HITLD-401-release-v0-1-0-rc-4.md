---
id: HITLD-401
title: "Release v0.1.0-rc.4"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
release: 0.1.0-rc.4
needs: [HITLD-400, HITLD-402, HITLD-403, HITLD-406, HITLD-65]
---

## Why

The fourth release candidate is an outside consuming project adopting HITLd (the owner's decision HITLD-358): a project other than this repository installs it from the guide, its own tracker survives its formatters and edits, and the owner's Windows machine runs it as macOS and Linux do. It follows v0.1.0-rc.3 (HITLD-400) and waits for the four milestones of this stage: a new project adopts HITLd from the guide alone (HITLD-402), a consuming project's tracker behaves as its guide says (HITLD-403), HITLd runs on Windows (HITLD-406), and settings hold (HITLD-65).

## Done when

- Release v0.1.0-rc.3 (HITLD-400) is made, and the four milestones this item needs are done, each by its own check.
- The gate: `hitld release propose --pre rc` (which finds this item by its `release` key) reports no gates and no missing release notes.
- The committed offline eval baseline is from a clean run of the final main.
- The release is made through the release pull request, as for rc.3: `hitld release make --pre rc --branch release/v0.1.0-rc.4` in the owner's turn, merged with the owner's sign-off, the `release` environment approved, the draft published.
- The consuming project that reported the install and tracker issues installs v0.1.0-rc.4 from the guide and runs one item to merged and closed, and the run is recorded.

## Notes

Made by the planning pass HITLD-343 on the owner's decision HITLD-358. Consumer setup through a package script (HITLD-25), a direct need of v0.1.0 before the pass, lands here through HITLD-402. Publishing to the npm registry (HITLD-138) is after v0.1.0 (its own note).
