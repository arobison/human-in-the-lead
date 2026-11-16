---
id: HITLD-168
title: When the quota probe runs
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. When a reading is needed and stale: The gate probes before starting work when the last reading is older than a set age, and again as the used share nears the reserve. No timer."
answered_at: 2026-11-16T01:34:41.003Z
answered_via: question-tool
answered_by: owner
---

## Question

When should the quota probe run?

Each probe is one small model request and a reading ages. Raised for HITLD-165.

Reversibility: two-way.

## Options and recommendation

- A. When a reading is needed and stale: The gate probes before starting work when the last reading is older than a set age, and again as the used share nears the reserve. No timer.
- B. On a fixed schedule: The chief of staff's hourly check-in probes every time.
- C. Only when the owner asks: No automatic probes; the declared estimate asks the owner for a fresh figure.

Recommended: When a reading is needed and stale. No timer, so an idle run spends nothing.

## Answer

Recorded in the front matter once answered.
