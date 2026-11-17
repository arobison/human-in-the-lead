---
id: HITLD-408
title: HITLd measures its own work and proposes changes from it
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: Estimates, learned parameters, token shares, description quality and friction counts come from the ledger with their uncertainty, and changes to them are proposed to the owner, never made silently.
done_when:
  - "c1: Items get calibrated token ranges and attention cost, and this repository records `estimate_tokens`."
  - "c2: Learned state and token accounting show in `hitld metrics` and the dashboard."
  - "c3: A description-quality guide, check and eval exist."
  - "c4: A friction digest per version, and an honest record for feedback the agent finds."
constraints: [HITLD-81 c1, HITLD-298 c1, HITLD-112 c2, HITLD-139 c2, HITLD-75 c3, HITLD-48 c4, HITLD-277 c4, HITLD-43 c4, HITLD-436 c1, HITLD-438 c1, HITLD-439 c1, HITLD-450 c1, HITLD-454 c1, HITLD-458 c1, HITLD-459 c1]
check: integration-test a seeded ledger produces the expected learned state, token shares and one proposal, and a seeded poor description is flagged
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-363; the owner commits it later. Stage: after v0.1.0. The owner decided that this repository enables `estimate_tokens` (HITLD-381).
