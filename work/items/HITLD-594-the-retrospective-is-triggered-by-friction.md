---
id: HITLD-594
title: The retrospective is triggered by friction signals, with a slow safety net
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: "A. Signal-driven, with a slow safety net: Per friction class a sensor, a second-sighting rule and a control-chart rule on the rate per decision (work-normalized, not wall-clock); a trigger starts a small curator retrospective on that class, which proposes an experiment the owner decides, with the same sensor giving the verdict; only the slow timer of HITLD-536 remains as a safety net"
answered_at: 2026-11-20T00:46:56.130Z
answered_via: question-tool
answered_by: owner
---

## Question

Should the retrospective be triggered by friction signals instead of a fixed cadence or an end-of-run retro?

The owner said a fixed cadence for retrospectives feels wrong. Design part 2's learning loop says a retro at the end of each run, and the run object is gone (HITLD-470). Part 11.4 has feedback controllers (sensor, rule, actuator, pair checked). HITLD-536: events first with a slow timer as a safety net. HITLD-387: the chief of staff files on a second sighting.

## Options and recommendation

- A. Signal-driven, with a slow safety net: Per friction class a sensor, a second-sighting rule and a control-chart rule on the rate per decision (work-normalized, not wall-clock); a trigger starts a small curator retrospective on that class, which proposes an experiment the owner decides, with the same sensor giving the verdict; only the slow timer of HITLD-536 remains as a safety net
- B. On boundaries only: Retrospect when a commitment ends or a merge batch completes
- C. A fixed slow cadence: A retrospective every few days

Recommended: Signal-driven, with a slow safety net. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
