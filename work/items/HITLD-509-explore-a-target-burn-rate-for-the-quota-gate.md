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

## Decided on 2026-11-19 (HITLD-530, 531)

- **The target pace (HITLD-530):** an even line from the window's start to the reserve at the reset. Ahead of the line the gate slows work early; behind it the system may use the spare capacity, but only on work a commitment allows. The reserve stays untouched, and the owner's own use counts as a draw on the line.
- **Shared by several projects and by use outside HITLd (HITLD-531):** one person-level pace on the account's total, recomputed continuously. Use outside HITLd (interactive work, other projects HITLd does not manage, on-off use) is the measured remainder and has priority. The HITLd portion is split into a share per project by the owner's weights, default an even split among projects with an active commitment. Every project's gate reads the same total, so none overshoots. This is a person-level aggregate, which HITLD-490 allows; no raw events cross projects.

## Open points

- **Readings come from the quota probe, not only the owner's figure.** The owner pointed out (2026-11-19) that a probe was already decided: HITLD-166, with HITLD-168 to 172 and HITLD-373. It uses the smallest model with a one-word prompt and reads the `rate_limit_event` that `claude` prints (the account's weekly utilization and its reset time), when the last reading is older than a set age (30 minutes to start). A fresh probe reading wins over a declared figure; a failed probe is escalated up the chain (HITLD-170, 171). It is not built yet: HITLD-165 is still `proposed`, and until it lands the declared figure (HITLD-149) is the only source. Because the probe reads the account total, it sees use outside HITLd directly; the split between projects comes from HITLd's own measured tokens (HITLD-438). The probe's format is undocumented and was sampled once on 2026-11-16, so the pace must treat an unrecognized reading as no reading.
- **Weights and the first window** (how the owner sets project weights, and whether the first window runs the line without learning anything) are not decided.

## Changed on 2026-11-19 (HITLD-549, replacing HITLD-531)

The owner raised the risk that projects knowing about each other can leak confidential information, and decided (HITLD-549) that projects are blind to each other and share the pace only through the account's total utilization, with no ceilings. HITLD-531's person-level layer that computes shares across projects is replaced. The even line (HITLD-530) stands. Each project follows it on the account total, read from the probe (HITLD-165) or the declared figure (HITLD-149). No project reads another project's data, and the person-level layer of HITLD-490 stays to learned aggregates only.

Existing work to start from (the owner asked for literature): the pace is a decentralized feedback controller. TCP congestion control (additive-increase, multiplicative-decrease, AIMD; Chiu and Jain, 1989) lets senders that know nothing about each other converge toward fair shares of one bottleneck, using only a shared congestion signal; here the signal is "the account total is ahead of the line" and the rate is a project's executor concurrency and spend. Cautions: feedback delay (the probe reads about every 30 minutes and spend accumulates over hours) needs conservative gains to avoid oscillating between sprinting and stalling; fairness only emerges among projects that are trying to use capacity; priority differences, if wanted, are a local setting (a weighted increase rate), not an exchange of information. Token buckets suit the line itself, and adaptive concurrency limits (AIMD-style limiters) apply to the executor count of HITLD-534. These are from the chief of staff's general knowledge and are not yet checked against the sources; the study should cite and check them.

## Decided on 2026-11-19, continued (HITLD-550)

The pace controller starts from AIMD with conservative gains: additive increase while the account total is below the line, multiplicative decrease when it is above, the same rule adapting executor concurrency (HITLD-534). Slow gains absorb the feedback delay. The study may swap it on evidence. A first window needs no special case: like TCP's slow start, the controller begins with a small rate and increases.

## Still to decide

The gains and the feedback interval, set from measurement once the probe (HITLD-165) exists.
