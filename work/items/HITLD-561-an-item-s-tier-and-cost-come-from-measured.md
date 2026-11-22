---
id: HITLD-561
title: An item's execution profile (mode, model and effort, token budget) comes from measured history, not a tier
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Why

Dispatch routes work to a discrete tier by a file count (`dispatch.tier1_max_touches` 3) and familiar yield, and issues 158 and 201 showed sizing ignored the plan and required reading, so every item sized as tier 3. The owner decided (HITLD-533) that measured history decides, with the plan as the prior, and then (HITLD-581) that discrete tiers go: a tier bundles three different things, an executor mechanism (inline, a background agent, its own session), a model and effort, and a default token budget, all picked up front from a few features. Only the first is naturally discrete.

## What it should do

- **Execution mode** (inline, background agent, own session) is picked from capability needs: long-running work, work that needs to ask the owner questions, heavy resource use (HITLD-559), interaction. It is not a measure of difficulty.
- **Model and effort** come from a cost-ordered cascade. The cascade starts at the cheapest rung that measured first-pass yield says is likely to work for items like this one, and escalates on a failure signal (stuck or over budget, HITLD-560; failed verification), carrying the failure forward. Predicted difficulty only chooses the starting rung. The model catalog (design part 5) supplies the rungs.
- **Token budget** is measured from the tokens of similar finished items (HITLD-438, 450), with the item's plan and required reading as the prior until there are enough completions. File count stays only as one weak input.
- `tier_override` on the item becomes a profile override (a mode, or a starting rung). The sizing controller's first-pass-yield measure is kept per rung.
- Reword the places that say "tier": the design part on sizing tiers, the planner, the briefs and the ledger fields.

## Done when

- The missing information is obtained first (the shape is settled in HITLD-533 and 581; the cascade's rungs, the failure signals and the override form are shaped), then a failing test that reproduces the gap: an item sizes as tier 3 for lack of a field today (design part 14.7).
- Dispatch picks a mode, a starting rung and a budget from the item and the history, and escalates on a failure signal; the ledger records the rung and each escalation.
- `tier_override` still works as a profile override, with a migration for items that set it.
- The design part on sizing tiers is rewritten in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Design: the shape is decided; the details (rungs, signals, override form) are walked through with the owner. Code and design: the owner's own yes to merge. Shape with HITLD-285 and 286 (the settings defaults sizing depends on). Folded items (HITLD-575): HITLD-287 and HITLD-500 are folded into this item and close when it lands; HITLD-285 and 286 stay as independent small fixes. Related: HITLD-532, 533, 559, 560, 581.

## Decisions of 2026-11-22 (HITLD-768 to 774)

The owner generalized the profile in a walk-through: an executor is described by capability dimensions (lifetime: in-process, detached process, own session; interaction: runs alone, asks, steered by a person; isolation: shared checkout, own worktree) plus runtime, provider, model, effort and budget. Cascade rungs are (runtime, provider, model, effort) entries declared in policy and ordered by cost, each declaring its data boundary and the guard enforcement it supports; an item's classification limits the rungs it may use; blast radius sets a floor on the starting rung. Tiers, `tier_override` and the tier settings are removed outright, with a one-time migration (`tier_override` becomes `profile_override`; ledger events keep reading old `tier` fields as history). Only the Claude Code adapter is built here; the working second adapter is HITLD-776. The design text is HITLD-775. HITLD-746 (detached executors) is the detached lifetime of this profile.
