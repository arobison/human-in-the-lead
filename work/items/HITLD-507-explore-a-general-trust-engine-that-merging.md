---
id: HITLD-507
title: Explore a general trust engine that merging, committing to work, releasing and the other processes that act without asking each hook into
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Done when

- A study, written up as a design note and walked through with the owner one question at a time, answers whether one general trust engine should serve every process that acts without asking, and what it would be. The note covers at least:
  - **The inventory.** Every process that has or wants a trust ladder, where it stands today and what it decides: merging without asking (HITLD-472), committing to work against budgets (HITLD-291), patch releases and other releases, the owner's delegation of tracker-only merges (HITLD-159), triage routing (`triage.confidence_floor`), questions that settle by default (`default_if_unanswered`), agent spend (`rights.agent_spend_max_tokens`), and executor routing (`dispatch.familiar_min_yield`).
  - **The shared concepts.** What a process declares to hook in (the kinds of decision it makes, the evidence that counts for and against each, the rungs, the unlock bar, the re-lock rule, the fences that never unlock) and what the engine does (keeps the record, proposes a rung change to the owner as a decision, enforces the current rung, re-locks at once on a miss).
  - **What exists.** The trust-calibration record (design part 2.15, `core/lib/rights/trust.mjs`, which only records), precedents (`core/lib/precedent`), the attention budget, and the rule that the system never grants itself autonomy (design part 4.6), which the engine must keep.
  - **The questions the engine raises.** Per-person trust once several humans contribute (HITLD-44, HITLD-501); where the person-level aggregate layer fits (HITLD-491); how a person sees every rung in one place (the dashboard); whether a rung on one process can lend confidence to another; and how a trust record is protected from the system editing it.
  - **A recommendation.** Whether to build the engine first and move merging and committing onto it, to build both by their own designs behind a common interface, or to leave them separate; with the order and the first item.
- The owner decides the recommendation in the walk-through; the design is updated and the items that build it are filed, each placed under a milestone.
- `hitld work check` passes.

## Why

The owner said on 2026-11-19, while designing the trust ladder for committing to work (HITLD-291) after the one for merging (HITLD-472), that there is an opportunity for a more general trust engine that each of these processes could hook into, and asked for a ticket to explore it. Both ladders came out with the same shape: kinds of decision on a scale of trust, three rungs, the same unlock bar and re-lock rule, and the same evidence idea. The owner decided in HITLD-506 that committing to work uses the merging machinery. Other processes in the design have the same need and the design records trust today only as counts per area (part 2.15).

## Notes

Design-heavy: stays proposed and is walked through with the owner. The study should keep HITLD-472 and HITLD-291 moving: both can be built against the common shape once it is settled. Related: HITLD-472, HITLD-291, HITLD-493 (the audit of defaults, which touches `trust.rubber_stamp_seconds` and the small-sample thresholds), HITLD-44 and HITLD-501 (several humans), HITLD-491, HITLD-409.
