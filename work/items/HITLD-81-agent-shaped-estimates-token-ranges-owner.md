---
id: HITLD-81
title: "Agent-shaped estimates: token ranges, owner-attention cost and rework, calibrated per area and tier"
kind: work
state: planned
created: 2026-11-15
project: HITLD-28
---

## Why

Effort is estimated in tokens from the median of similar past items (design 5.1), a good start for agents. Three things are missing. A single number hides the spread, and large or novel items are exactly where it is wide. The scarce resource is the owner's attention (design 1.2), and nothing estimates how much of it an item will take. And an item that needs rework costs more than its first pass. The owner asked for estimates shaped for agents, after v0.1.0-rc.1.

## Done when

- Each item gets a token range from its reference class: a median and a 90th percentile. Appetites and the reserve are planned on the 90th; the "report back" threshold sits between the two. A wide range triggers splitting or shaping instead of a dispatch.
- Each item gets an expected owner-attention cost (questions likely to reach the owner, and reading the owner must do), learned from the ledger of similar items, and prioritization divides by attention as well as tokens.
- Expected cost includes rework: the token estimate divided by the first-pass yield of its area and tier.
- With no history, the executor's own estimate from its plan is used at low confidence and calibrated as actuals arrive.
- Each estimator's bias and spread are tracked per area and tier (design 5.1), shown in the run report, and an eval scenario checks that a seeded biased estimator is corrected.
- Value stays a person's judgment (HITLD-80); agents do not estimate it.

