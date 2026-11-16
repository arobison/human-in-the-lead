---
id: HITLD-455
title: "Merge of PR #280 (HITLD-438), measured tokens for completions"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Merge it: The chief of staff squash-merges the verified head; HITLD-450 starts next."
answered_at: 2026-11-16T23:45:12.326Z
answered_via: question-tool
answered_by: owner
---

## Question

Merge PR #280 (HITLD-438)? A completion's tokens are read from the harness's record; an executor's own figure is kept apart as a guess. It adds --session-record and three optional ledger fields (additive, no version bump). All 11 checks passed at head 4756e6356928 and there was no conflict.

Code, a ledger schema change and design: the owner's own yes is needed.

## Options and recommendation

- A. Merge it: The chief of staff squash-merges the verified head; HITLD-450 starts next.
- B. Hold: Left open; HITLD-450 and everything after it keep waiting.

Recommended: Merge it. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
