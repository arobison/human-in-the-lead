---
id: HITLD-604
title: The repeated-ID crash closes with the unique-ID design, and interactive follow-ups fold into one item
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: "A. Close 281 when the unique-ID design lands, fold 314 into 497: 281 closes when HITLD-74 lands; 314 becomes part of 497; the other twelve stay"
answered_at: 2026-11-20T01:04:59.872Z
answered_via: question-tool
answered_by: owner
---

## Question

What should happen to the crash on a repeated ledger event ID (HITLD-281) and the refusal of follow-ups to an interactive dispatch (HITLD-314)?

HITLD-281's collision class is removed by the unique-by-construction IDs (HITLD-74, HITLD-489); HITLD-314 overlaps HITLD-497 (follow-up work that outlives its session).

## Options and recommendation

- A. Close 281 when the unique-ID design lands, fold 314 into 497: 281 closes when HITLD-74 lands; 314 becomes part of 497; the other twelve stay
- B. Keep all 14 as they are: Nothing folded or closed
- C. Also drop the three merge-approval items until checked: As the first option, and move HITLD-494, 495 and 496 out of rc.3 until checked

Recommended: Close 281 when the unique-ID design lands, fold 314 into 497. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
