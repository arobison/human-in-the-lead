---
id: HITLD-640
title: Show with measured evidence which harness and model combination reaches accepted outcomes with fewer tokens and less cost
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-561]
---

## Done when

- A study defines the comparison: the metric (tokens and cost per accepted item, with first-pass yield, escaped defects and wall time beside it, so a cheap but poor combination does not win), how a harness and model combination is identified, and how results from different providers are made comparable.
- The study defines the method: a paired comparison, where the same standard sample of items is replayed on each combination (the replay design 11.4 already uses when a model changes), and an observational comparison over the ledger, stratified by item type and area, with the sample size and uncertainty stated, not a bare ranking.
- The result says whether the measured history can already support such a claim, what would have to be recorded for it to (for example tokens by role and by phase from each harness's own record, HITLD-584), and what a combination's record feeds: the catalog's calibration (design 5.8), the cascade's starting rung and the execution profile (HITLD-561).
- The comparison shows in `hitld metrics`, with the evidence behind each figure.
- `hitld work check` passes.

## Why

The owner asked on 2026-11-20 how HITLD adapts its token efficiency systems to different models for different tasks across providers and harnesses, and wants quantitative evidence that one harness and model combination beats another in token efficiency toward outcomes.

What the design already does: it measures tokens per accepted item with first-pass yield and escaped defects, by execution profile, item type and area (design 11); the cascade starts at the cheapest rung whose measured first-pass yield for that kind of item meets a floor (5.1); the model catalog keeps per-model calibration (first-pass yield, estimate bias and spread) (5.8); and when a model changes, estimators reset and widen, starting rungs return to defaults and a replay of a standard sample measures the change before it is trusted (11, recalibrating on model changes). What is missing: calibration is keyed by model within a harness, not by the harness and model together, so an overhead that belongs to a harness (its system prompt, skills and tool-call tokens) is not separated from the model's; tokens are not comparable across providers (different tokenizers, caching and prices), so a fair comparison needs cost as well as tokens; and observed history alone is confounded by item difficulty, so a ranking from it needs stratification or the paired replay.

## Notes

A learning item for later, so it is placed after v0.1.0 under HITLD-408 clause c2 as a proposal. Related: HITLD-616 (executors on other harnesses and models), HITLD-561 (execution profile from measured history), HITLD-584 (the token view by role), HITLD-12 and 52 (live evals across models and providers), design parts 5.8 and 11.
