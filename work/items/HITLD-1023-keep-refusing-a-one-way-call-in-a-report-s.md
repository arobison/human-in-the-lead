---
id: HITLD-1023
title: Keep refusing a one-way call in a report's calls (HITLD-853)
kind: decision
state: done
created: 2026-11-24
project: HITLD-15
decider: owner
answer: "A. Keep the refusal: Send 613 back: the parser keeps refusing a one-way call and its error points to questions; the public report schema stays as it is."
answered_at: 2026-11-24T06:44:21.308Z
answered_via: question-tool
answered_by: owner
---

## Question

PR 613 would let a report's calls line end (one-way), but the contract, briefs and skills say only (reversible). Which rule do you want?

Today a one-way call is refused, which forces the executor to put it under questions for the owner. Merging 613 would let an executor declare one under calls, and the branch would still queue to merge with nothing holding it.

## Options and recommendation

- A. Keep the refusal: Send 613 back: the parser keeps refusing a one-way call and its error points to questions; the public report schema stays as it is.
- B. Allow one-way in calls and hold the merge: Send 613 back to update the contract, briefs, skills and design text and make a one-way call hold the item for the owner's yes.
- C. Merge as is: The schema widens and a one-way call rides along in calls with nothing holding it.

Recommended: Keep the refusal. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
