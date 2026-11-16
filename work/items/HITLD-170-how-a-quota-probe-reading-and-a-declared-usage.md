---
id: HITLD-170
title: How a quota probe reading and a declared usage figure combine
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Measured while fresh, else the declared estimate: A probe reading is used whenever it is younger than the stale age, and the declared estimate only when no fresh reading exists."
answered_at: 2026-11-16T01:34:47.491Z
answered_via: question-tool
answered_by: owner
---

## Question

How should a probe reading and the owner's declared figure combine in the quota gate?

Both can exist at once and they can disagree. Raised for HITLD-165.

Reversibility: two-way.

## Options and recommendation

- A. Measured while fresh, else the declared estimate: A probe reading is used whenever it is younger than the stale age, and the declared estimate only when no fresh reading exists.
- B. Newest wins, a tie goes to measured: Whichever was recorded last is used.
- C. Use the lower headroom of the two: When both exist the gate takes whichever shows less room.

Recommended: Measured while fresh, else the declared estimate. Measured is the truth and the declared figure is the fallback, so they never fight.

## Answer

Recorded in the front matter once answered.
