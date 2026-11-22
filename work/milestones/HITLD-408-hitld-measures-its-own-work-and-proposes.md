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
  - "c3: A description-quality guide, check and eval exist, and signals that a description was poor are recorded."
  - "c4: A friction digest per version, and an honest record for feedback the agent finds."
check: integration-test a seeded ledger produces the expected learned state, token shares and one proposal, and a seeded poor description is flagged
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-363; the owner commits it later. Stage: after v0.1.0. The owner decided that this repository enables `estimate_tokens` (HITLD-381).

## Changed on 2026-11-20 (HITLD-602, 605, 608)

HITLD-511 (merge-risk prediction) and HITLD-444 (the Roadmap routing polish) joined clause c2 here, after v0.1.0. HITLD-595 and HITLD-596 left clause c4 for milestone HITLD-403 (clause c5).

HITLD-622 (a project-owned data area in the private store, later option) joined clause c2 on the owner's decision HITLD-623.

HITLD-640 (evidence of which harness and model combination reaches accepted outcomes for fewer tokens) joined clause c2 as a proposal.

HITLD-643 (the GitHub Copilot adapter design) joined clause c2 on the owner's decision HITLD-642, after v0.1.0.

On the owner's decision (2026-11-21, HITLD-700), HITLD-698 joins clause c3, which now also says that signals a description was poor are recorded: HITLD-75 was split, and its last two clauses (the signals, and checking the guide's rules against outcomes) became HITLD-698.
