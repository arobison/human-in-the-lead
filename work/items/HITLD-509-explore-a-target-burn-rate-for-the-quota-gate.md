---
id: HITLD-509
title: "Explore a target burn rate for the quota gate: appetite, shape and floor, with concurrency set from measured per-executor burn and the owner's review throughput"
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Done when

- A study, written up as a design note and walked through with the owner one question at a time, answers how the quota gate should pace work against the plan's limits and the owner's wall time, not only react to how much is left. The note covers at least:
  - **The target.** A target burn rate in plan-percent per hour (the unit the gate already uses), by default the usable budget over the window length: for a weekly window with the 25 percent reserve, about 0.45 percent of the plan per hour; and whether a pace error (actual burn against target) replaces or sits beside the level bands (`quota.reserve`, `quota.economize_below`, `quota.critical_below`) and `quota.forecast_hours`.
  - **Appetite.** The share of the plan HITLd may use, with the rest left for the owner's own interactive use. How burn is attributed to HITLd and to the owner's other use, which nothing does today; the measured per-dispatch figures from session records (HITLD-438) and the plan-percent readings do not yet join. It is also the budget unit for goals under a budget (HITLD-291).
  - **Shape.** Even, front-loaded, or deadline-driven (spend what a goal needs by its date), and what the owner needs left each day.
  - **The floor.** The reserve stays a hard stop.
  - **Wall time and concurrency.** Burn rate is about the number of executors times the burn per executor-hour; with per-executor burn measured, concurrency can be derived from the target. A goal's required rate (remaining estimated tokens over time left) against the available pace says when a goal is infeasible, and the system says so.
  - **The owner's review throughput as a bound.** A pace faster than the owner merges piles up finished, unmerged work (the `awaiting_merge` state), so the target is the lower of the plan pace and the review capacity.
  - **What the owner sees.** The pace line against actual burn on the dashboard, and what the chief of staff says when work is ahead of or behind pace.
- The owner decides the design in the walk-through; the design (part 12) and the settings schema are updated and the items that build it are filed, each placed under a milestone.
- `hitld work check` passes.

## Why

The owner asked on 2026-11-19 what the target token burn rate should be, and how to think about wall time in the context of token appetite and plan limits, as another knob for budgeting. The gate today compares how much is left against fixed bands. In the window ending 2026-11-20 the run used about 67 percent of the weekly limit in about 75 hours (about 0.9 percent an hour, including the owner's other use), roughly twice the pace line, so the economize and critical bands fired late and the run then idled for the rest of the window. A pace, not a level, would have slowed work earlier and spread it. These figures are the chief of staff's reading of the owner's declared snapshot and the reset time, not a measurement.

## Notes

Design-heavy: stays proposed and is walked through with the owner. Related: HITLD-291 (a goal under a budget; what a budget holds), HITLD-418 (how usage limits are reported on different plans), HITLD-351 and HITLD-422 (weekly usage above the reserve), HITLD-149 (a declared usage figure reaching the gate), HITLD-438 (measured per-dispatch tokens), HITLD-153 (the `awaiting_merge` state), HITLD-165, HITLD-493 (the audit of numeric defaults), HITLD-508 (executors and providers differ in cost and speed).
