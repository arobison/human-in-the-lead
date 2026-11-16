---
id: HITLD-169
title: Which model the quota probe uses and how its cost is counted
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Smallest model, cost recorded as probe spend: A one-word prompt on the smallest model, with the cost written to the ledger tagged as probe spend and not counted against any item's budget."
answered_at: 2026-11-16T01:34:44.305Z
answered_via: question-tool
answered_by: owner
---

## Question

Which model should the quota probe use, and how is its own cost counted?

The probe spends a little of the quota it measures. Raised for HITLD-165.

Reversibility: two-way.

## Options and recommendation

- A. Smallest model, cost recorded as probe spend: A one-word prompt on the smallest model, with the cost written to the ledger tagged as probe spend and not counted against any item's budget.
- B. Whatever model the session uses: No model setting, and a reading costs more.
- C. Smallest model, cost not tracked: Same call with nothing recorded about what it costs.

Recommended: Smallest model, cost recorded as probe spend. Each reading is a few tokens, and the owner can see what measuring costs.

## Answer

Recorded in the front matter once answered.
