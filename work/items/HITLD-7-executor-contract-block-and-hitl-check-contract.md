---
id: HITLD-7
title: Executor contract block and hitld check contract (piece d)
kind: work
state: done
created: 2026-11-14
project: HITLD-2
---

## Why

Part of the slice usable in a consuming project.

## Done when

- `hitld install` writes the executor contract block between its markers and rewrites only what is between them.
- `hitld check contract` passes on a conforming file and fails on a missing, edited or stale block.
- The report shape is checked, and a report with a missing field fails.
- Tests and the offline report-shape scenarios pass.
