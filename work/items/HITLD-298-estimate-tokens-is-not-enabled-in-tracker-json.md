---
id: HITLD-298
title: estimate_tokens is not enabled in tracker.json, so critical paths weigh every item as 1
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

Found by D-20 while building the milestone graph (HITLD-62). `estimate_tokens` is not in `.human-in-the-lead/tracker.json` `optional_keys`, so no item carries an estimate and the critical path weighs every item as 1. The planner and the milestone graph's "tokens left" axis therefore have nothing to weigh. It is a question for the owner whether that is intended. Related: HITLD-81 (agent-shaped estimates).

## Done when

- The owner decides whether this repository enables `estimate_tokens`.
- If yes, it is enabled and the milestone graph's critical path uses it; if no, the item is dropped with a reason.

## Decided

The owner decided on 2026-11-16 (decision HITLD-381): this repository enables `estimate_tokens` (add it to `optional_keys` in `.human-in-the-lead/tracker.json`), and the milestone graph's critical path and tokens-left axis use it.
