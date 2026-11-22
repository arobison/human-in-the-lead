---
id: HITLD-772
title: "Executor profile: how blast radius enters it"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. It sets a floor on the cascade rung: Items touching declared sensitive paths start no lower than a configured rung and never on a rung with a weaker data boundary or guard enforcement than the work needs; mode and review are unchanged."
answered_at: 2026-11-22T02:44:08.708Z
answered_via: question-tool
answered_by: owner
---

## Question

How does an item's blast radius enter its execution profile?

Design 5.1 left it undecided; the old tiers moved an item up a tier for it.

## Options and recommendation

- A. It sets a floor on the cascade rung: Items touching declared sensitive paths start no lower than a configured rung and never on a rung with a weaker data boundary or guard enforcement than the work needs; mode and review are unchanged.
- B. One more weak input like file count: A nudge to the starting rung.
- C. It forces a stronger review, not a stronger executor: A second reviewer pass.

Recommended: It sets a floor on the cascade rung. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
