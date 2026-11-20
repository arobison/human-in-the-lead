---
id: HITLD-581
title: Discrete tiers are replaced by an execution mode, a cost-ordered cascade and a measured budget
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: "A. Replace tiers with mode, cascade and measured budget: Execution mode is picked from capability needs; model and effort come from a cost-ordered cascade that starts at the cheapest rung history says will work and escalates on stuck, over-budget or failed verification; the token budget is measured from similar finished items; tier_override becomes a profile override"
answered_at: 2026-11-20T00:08:25.316Z
answered_via: question-tool
answered_by: owner
---

## Question

Should discrete tiers go, replaced by a chosen execution mode, a cost-ordered model-and-effort cascade and a measured token budget?

The owner said discrete tiers smell funny. A tier bundles an executor mechanism (inline, background agent, own session), a model and effort, and a default token budget, picked up front from a few features. HITLD-533 and 561 made the tier come from measured history but kept the tiers.

## Options and recommendation

- A. Replace tiers with mode, cascade and measured budget: Execution mode is picked from capability needs; model and effort come from a cost-ordered cascade that starts at the cheapest rung history says will work and escalates on stuck, over-budget or failed verification; the token budget is measured from similar finished items; tier_override becomes a profile override
- B. Keep tiers, but learn the boundaries: Three levels set from a continuous difficulty score
- C. Keep tiers as they are: Only change how the estimate is made

Recommended: Replace tiers with mode, cascade and measured budget. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
