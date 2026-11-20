---
id: HITLD-596
title: "A friction controller: a sensor, a second-sighting rule and a rate rule per class start a scoped curator retrospective"
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-595, HITLD-583]
---

## Why

Design part 2's learning loop says "a retro at the end of each run", and the run object is gone (HITLD-470), so that trigger has no meaning; a fixed cadence would be the clock the owner objected to. The owner decided (HITLD-594) that retrospectives are triggered by friction signals, with a slow safety net. Part 11.4 already has the shape: feedback controllers with a sensor, a rule and an actuator, each logging its evaluations so they can be replayed.

## What it should do

- **One sensor per friction class**, fed by the friction events of HITLD-595. The rate is per owner decision settled (work-normalized), never per day, so quiet periods do not skew it.
- **Triggers**, either of which opens a case for a class: a second sighting of the same class after a fix has been adopted (a regression), which is the rule the chief of staff already follows for investigations (HITLD-387); or a rate that stays above its baseline by a control-chart rule (an exponentially weighted moving average, or a cumulative sum, over the per-decision rate), with the baseline and limits set from history and shown to the owner.
- **The actuator is a scoped curator retrospective on that class only**, as a job of the curator (HITLD-583, 587): a small read-only analysis of the events of one class, producing claims with evidence and at most a few proposals. It is not a calendar event and not a whole-run review.
- **Proposals become experiments** by part 2's rules: a hypothesis, one in flight per controlled setting, the eval gate on any skill or policy change, and the owner's decision to adopt. A proposal that is only a working-style preference becomes a confirmed entry in the preference record (HITLD-570), which never grants authority. Low-severity proposals are batched into the owner's digest and every ask counts against the attention limit (HITLD-538).
- **The verdict comes from the same sensor** after the change is adopted: did the class's rate per decision fall, and did the paired measure (tokens, owner attention) hold? A change that does not move its rate is flagged, and a rise in the rate after adoption is a second sighting.
- **Only the slow safety-net timer remains** (HITLD-536), to catch classes with no sensor yet and lost events. A commitment ending (HITLD-554) is a natural boundary that can also open a case.
- Every evaluation of the controller is logged with its sensor values, setpoint, action and reason, and can be replayed (design 12.3).

## Done when

- The missing information is obtained first (the shape is settled in HITLD-594; the baseline method, the limits and the scope of a retrospective are shaped with the owner), then a failing test that reproduces the gap: a class that repeats after a fix does not open a case today (design part 14.7).
- The controller opens a case on a second sighting and on a rate above its limit in a replay of this run's events, and a case starts a scoped retrospective job whose result is a proposal, not a change.
- The design part on the learning loop is rewritten for it in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Design-heavy in its details: stays `proposed` and is walked through with the owner after the signals exist (HITLD-595), since the baseline needs data. Code and design: the owner's own yes to merge. Needs HITLD-595 and the curator (HITLD-583). Placed under HITLD-408 c4 (friction counts come from the ledger, and changes to them are proposed to the owner) by the chief of staff, a proposal for the owner to move. Related: design parts 2 and 11.4, HITLD-387, 536, 538, 570, 587.
