---
id: HITLD-57
title: "The end-to-end eval runner and `claude plugin eval` scenarios for skills"
kind: work
status: Planned
created: 2026-11-14
project: HITLD-28
---

## Why

Design 17.5 and 17.8: skills are checked by `claude plugin eval`, and whole flows (a bug to a merge, a question that becomes precedent, a restart mid-run) need a runner that drives a fixture repository from start to finish. Q8 settles that offline integration evals stay with our runner.

## Done when

- The end-to-end runner takes a fixture repository and a flow, drives it through the fake adapter, and grades the ledger and the repository.
- Three flows run: a bug to a merge, a question that becomes a precedent, a restart mid-run.
- Each skill has scenarios that run under `claude plugin eval`, and a skill without one fails `hitld eval --offline`.
- A deliberately degraded skill fails its scenario.
- Results record version and model, and `hitld eval --offline` runs both runners.
