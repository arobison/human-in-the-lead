---
id: HITLD-33
title: Live evals and the Copilot cloud agent profile
kind: work
status: Planned
created: 2026-11-14
project: HITLD-28
needs: [HITLD-52]
milestone: evals-gate
---

## Why

k = 3, the budget set from the first measured baseline (Q9).

## Done when

- `hitld eval --live` runs the affected scenarios with k = 3 per change and the full suite per release.
- A baseline is recorded for the Claude Code harness with its model and settings, and the budget is set from it.
- A deliberately degraded skill fails the regression gate.
- The Copilot cloud agent profile passes against the fake adapter.
