---
id: HITLD-439
title: Wherever the planner or a brief states a cost, it says where the estimate came from and how many completions it rests on
kind: work
state: done
created: 2026-11-16
project: HITLD-15
needs: [HITLD-436]
claimed_by: D-36
release_note: "Every cost the planner states says where it came from and how many completions it rests on: `hitld ready` and the plan's start list carry `estimate_basis` and `estimate_samples`, the brief's Budget line and the quota gate's reason name the source, and the plan lists the estimate settings. New `dispatch` settings `estimate_min_samples` (default 3, was a constant) and `estimate_max_multiple` (default 3): a median of past completions more than that many times the tier's default is not used, and the plan says so."
---

## Done when




- Every place the planner or a generated brief states a cost (the plan's `start` list, `ready`, a brief's "Budget" line, the gate's "would cross the reserve" reason) also says where the figure came from (a default, the item's own `estimate_tokens`, or the ledger's median of completions) and how many completions it rests on.
- When the figure rests on fewer completions than the estimator's minimum sample, or is more than a set multiple of the default, the plan says so and falls back to the default instead of using it, so one odd record cannot set every estimate (the robust estimator is HITLD-436; this item makes the choice visible and testable from the plan).
- `hitld config explain` or the plan names the setting for the minimum sample and the multiple. HITLD-436 added the minimum sample as a constant (`ESTIMATE_MIN_SAMPLES`, 3); this item makes it a policy setting instead of adding a second one.
- Two wording changes the owner accepted (decision HITLD-447): `skills/orchestrate/SKILL.md` (the line on `--tokens`, about line 109) says what to count ("output plus fresh input, never cache reads; a figure 3x the estimate is refused without --tokens-over-estimate"), and design 05-execution (the token-estimate paragraph) says the estimate needs at least 3 such completions, otherwise the default. The PR carries a skill and design change: the owner's own yes.
- Tests cover a default, an item estimate, a ledger median, a small sample and a figure far above the default. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The planner's estimate for the next items read 1,882,231 tokens after one bad record, and the generated brief printed "Budget: ~1882k tokens" as if it were fact. Nothing in the plan said the figure rested on one completion, so nobody could see that it was wrong until the orchestrator said so. The owner asked for follow-up tickets that come before the rest of the work (decision HITLD-440).

## Notes

Needs HITLD-436. Related: HITLD-81, HITLD-298. Placed under HITLD-408 c1. Code: needs the owner's own yes to merge.
