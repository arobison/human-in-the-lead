---
id: HITLD-57
title: "The end-to-end eval runner and `claude plugin eval` scenarios for skills"
kind: work
state: proposed
created: 2026-11-14
project: HITLD-28
needs: [HITLD-137]
---

## Why

Design 17.5 and 17.8: skills are checked by `claude plugin eval`, and whole flows (a bug to a merge, a question that becomes precedent, a restart mid-run) need a runner that drives a fixture repository from start to finish. Q8 settles that offline integration evals stay with our runner.

## Done when

- The end-to-end runner takes a fixture repository and a flow, drives it through the fake adapter, and grades the ledger and the repository.
- Three flows run: a bug to a merge, a question that becomes a precedent, a restart mid-run.
- Each skill has scenarios that run under `claude plugin eval`, and a skill without one fails `hitld eval --offline`.
- A deliberately degraded skill fails its scenario.
- Results record version and model, and `hitld eval --offline` runs both runners.

Held until after the v0.1.0-rc.2 release (HITLD-137) on the owner's choice, 2026-11-16 (HITLD-242): the planner offered it ahead of the rc.2 work, it touches every skill and the eval gate, and it needs about 1.4M tokens. The `needs` on HITLD-137 is that hold.

## Returned to proposed on 2026-11-20 (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (470/492): e2e eval 'restart mid-run' flow built on run resume; needs HITLD-137. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); the ledger and no-run decisions (HITLD-484 to 490). The owner decided (HITLD-578) that the items the decisions change most return to `proposed` until reshaped, so the planner does not offer them; the owner promotes the item again once it is reshaped.
