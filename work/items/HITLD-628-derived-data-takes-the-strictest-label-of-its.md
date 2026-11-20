---
id: HITLD-628
title: Derived data takes the strictest label of its inputs, unless the owner lowers a named kind
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: Strictest of its inputs, unless you lower a named kind (Recommended)
answered_at: 2026-11-20T03:41:50.796Z
answered_via: question-tool
answered_by: owner
---

## Question

What label does something derived from labeled data get (a verdict, a summary, a headline, a result ID)?

HITLD-620: the public tracker must carry references to confidential benchmark results without values (HITLD-617).

## Options and recommendation

- A. Strictest of its inputs, unless the owner lowers a named kind: Nothing is lowered by default; a named kind such as verdict plus headline with no values, or a bare result ID, may be lowered by a signed decision
- B. Always the same as the source: Derived data never gets a lower label
- C. References are always one step lower: A result ID or headline is automatically less sensitive

Recommended: Strictest of its inputs, unless the owner lowers a named kind. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
