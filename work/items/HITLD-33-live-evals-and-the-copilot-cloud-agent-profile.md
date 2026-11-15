---
id: HITLD-33
title: Live evals and the Copilot cloud agent profile
kind: work
state: planned
created: 2026-11-14
project: HITLD-28
needs: [HITLD-52]
---

## Why

k = 3, the budget set from the first measured baseline (Q9).

## Done when

- `hitld eval --live` runs the affected scenarios with k = 3 per change and the full suite per release.
- A baseline is recorded for the Claude Code harness with its model and settings, and the budget is set from it.
- A deliberately degraded skill fails the regression gate.
- The Copilot cloud agent profile passes against the fake adapter.
- The first live scenarios cover what offline scenarios cannot, because they need a model: the chief of staff does not record an answer relayed from another session's report and asks the owner instead; decisions are asked with the harness's question tool, not as text to type; no private name (from the private term list) appears in a pull request title or body, comment or commit message an agent writes; and no private key is printed in any session's output.
