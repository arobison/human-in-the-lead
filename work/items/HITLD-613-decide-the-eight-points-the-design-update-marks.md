---
id: HITLD-613
title: Decide the eight points the design update marks "not decided"
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
constraint_of: [HITLD-405 c1]
---

## Done when

- The owner has decided each point below, one question at a time, and each answer is recorded as a decision.
- The design parts are updated to the answers, and build items are filed where a decision needs code.
- `hitld work check` passes.

## Why

The design-docs update (HITLD-572) merged with eight points marked "not decided" in the text, because no decision or item covers them. Each is cited in the parts where it appears; this item holds them in one place so none is lost.

1. Whether a person-level ceiling on executors across all of a person's projects stays (projects are blind to each other, HITLD-549; only a project's own ceiling is set, HITLD-534). Related: HITLD-559.
2. How blast radius enters an execution profile (HITLD-581 is silent; HITLD-561 builds the profiles).
3. What makes a first calibration review due now that its small-sample threshold is dropped (HITLD-535, HITLD-557).
4. Whether the quota bands (economize and critical) stay beside the pace controller (HITLD-550 chose AIMD but is silent on the bands; HITLD-558 builds the controller).
5. How a commitment's budget (HITLD-522) is checked against the quota model.
6. Where the controller settings live once the run state is gone (HITLD-492 is silent).
7. How shaping and scoping relate to a budget now that appetite means estimated size (HITLD-577 defines terms only); other old uses of "appetite" as a spending limit remain in the loops and data-model parts until this is decided.
8. How a commitment kind's evidence restarts after a one-mode drop (HITLD-506 says only that it drops a rung).

## Notes

Design-heavy: stays `proposed` and is walked through with the owner, one question at a time, before any build. Placed under HITLD-405 clause c1 (the same clause as the design-docs update HITLD-572) as a proposal for the owner to move.
