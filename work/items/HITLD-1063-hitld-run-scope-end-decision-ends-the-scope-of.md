---
id: HITLD-1063
title: `hitld run scope end --decision` ends the scope of a named decision, and ending with no scope file is not refused as no-scope
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `hitld run scope end` takes `--decision <ID>`; with it, the end is recorded in the ledger for that decision even when `run/scope.json` is missing, so a scope answered in another session or lost with a store problem can still be ended.
- Without `--decision` and with no scope file, the refusal says which of the two it is; tests cover a missing file with and without `--decision`.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The run-scope review of HITLD-877: `run scope end` refuses `no-scope` when the scope file is missing (`core/lib/cli/commands/orchestrator.mjs`), so a scope whose decision was answered outside this run cannot be ended by the command written to end it.

## Notes

rc.3. Follows HITLD-877 (merged). The orchestrate and chief-of-staff skills describe the command: skill text is owner-held (the owner's own yes).
