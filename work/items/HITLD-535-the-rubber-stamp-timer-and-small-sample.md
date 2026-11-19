---
id: HITLD-535
title: The rubber-stamp timer and small-sample thresholds stop being trust inputs
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. Drop them as trust inputs: The owner's yes speed and small counts no longer feed any trust or review decision; a measure of review keep-up, if wanted, is a metric (HITLD-408), not a rule"
answered_at: 2026-11-19T23:16:20.546Z
answered_via: question-tool
answered_by: owner
---

## Question

What happens to trust.rubber_stamp_seconds and the small-sample thresholds now that trust rests on evidence?

HITLD-493: trust.rubber_stamp_seconds (60) reads a fast yes from the owner as inattention; precedent.review_min_applications (3) and review.first_after_outcomes (5) decide when a pattern counts. HITLD-473 dropped approval counts as the trust signal; HITLD-472 and 507 replace them with evidence.

## Options and recommendation

- A. Drop them as trust inputs: The owner's yes speed and small counts no longer feed any trust or review decision; a measure of review keep-up, if wanted, is a metric (HITLD-408), not a rule
- B. Keep them, retuned: Keep the timer and thresholds as guards with the numbers revisited
- C. Keep rubber-stamp only as a warning: The timer only flags a suspiciously fast approval of a risky change; the sample thresholds go

Recommended: Drop them as trust inputs. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
