---
id: HITLD-848
title: Design how dollar budgets work next to token budgets and the plan-percent gate
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c4]
---


## Why

Budgets today are tokens (the run scope's `budget_tokens`, the per-dispatch cap the HITLD-782 hook counts) and plan-percent (the weekly Claude limit and its reserve); quota limits can name a `usd` unit but nothing budgets dollars per run, item or project. On a subscription the harness's dollar figure is an API-equivalent estimate, so dollars are an efficiency and comparison measure unless the owner pays by the token.

## Done when

- The owner decides, in a design walk-through one question at a time: whether dollars are a budget or only a report; the scopes (run, item, project, week); hard or soft; how dollars relate to the plan-percent gate and the reserve; and what happens at a limit.
- The answers are recorded as decisions, and design part 12 and the policy schema say them through the curator job; build items follow, each under a milestone.
- `hitld work check` passes.
