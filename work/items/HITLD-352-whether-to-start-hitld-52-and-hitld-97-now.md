---
id: HITLD-352
title: Whether to start HITLD-52 and HITLD-97 now
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Hold both: Nothing starts; both need an external item (HITLD-351) that closes when the window resets or the owner gives a lower reading."
answered_at: 2026-11-16T17:30:24.483Z
answered_via: question-tool
answered_by: owner
---

## Question

Start HITLD-52 (large live evals) and HITLD-97 (tracker interchange format) now, with weekly usage at 64% and the reserve forecast to be reached today?

They became critical-path items once HITLD-109 was held for the owner, so the usage gate let them through. HITLD-52 may cost about 1.5M tokens.

## Options and recommendation

- A. Hold both: Nothing starts; both need an external item (HITLD-351) that closes when the window resets or the owner gives a lower reading.
- B. Start HITLD-52 only: The live-evals executor starts and likely crosses the reserve.
- C. Start both: Two large executors run at once.

Recommended: Hold both. The owner said the scheduler not picking the evals was fine, and the reserve protects their other project's headroom.

## Answer

Recorded in the front matter once answered.
