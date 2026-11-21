---
id: HITLD-691
title: The dashboard data contract is one versioned surface that HITLD's page and a project's extensions read
kind: work
state: planned
created: 2026-11-21
project: HITLD-15
---

## Why

Decided by the owner (HITLD-683, in the walk-through of HITLD-681): the stable, versioned surface that HITLD's own page and a project's extensions read is everything the dashboard reads today. `hitld dashboard --json` already returns a data contract (design 12.4); this item makes it one documented, versioned surface.

## Done when

- One data contract, with an `api_version`, covers items and their fields (including a project's declared fields from `tracker.json`), claims, the committed state history, ledger summaries and usage snapshots. Adding a field keeps the version; removing, renaming or retyping one raises it, and callers ignore unknown fields.
- `hitld dashboard --json` and `--no-write` return it, and HITLD's own built-in views read only from it (no view reads the tracker or the ledger around it).
- The contract is described in a schema under `schemas/`, with a test that the output validates against it and a test that a project's declared field appears in it.
- A project's data in it respects classification: a field or summary carries its label where one is set, and nothing confidential is added to the contract by default.
- `npm run check`, the offline eval gate and `hitld work check` pass.
