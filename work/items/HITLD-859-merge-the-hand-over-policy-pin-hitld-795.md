---
id: HITLD-859
title: Merge the hand-over policy pin (HITLD-795)
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Yes, merge it: Pin 0.3 and 8 in the policy."
answered_at: 2026-11-22T17:24:09.573Z
answered_via: question-tool
answered_by: owner
---

## Question

PR 535 pins the orchestrator hand-over limits 0.3 and 8 in this repository's policy; the package defaults already hold them (HITLD-796). Merge it?

Merging changes nothing in effect; it makes the values explicit in config explain. The overnight stall came from the limits, not from this PR.

## Options and recommendation

- A. Yes, merge it: Pin 0.3 and 8 in the policy.
- B. Hold it: Keep open while limits are reconsidered.
- C. Close it: Rely on package defaults.

Recommended: Yes, merge it. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
