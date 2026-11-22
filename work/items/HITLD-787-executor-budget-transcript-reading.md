---
id: HITLD-787
title: "Executor budget: transcript reading"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Yes, counts only, never content: The hook adds up each message's usage numbers and discards everything else; a test asserts transcript text never reaches output or the ledger; a written exception to the no-transcripts rule."
answered_at: 2026-11-22T03:55:38.972Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-782 question 2: may the budget hook read token counts from the executor's transcript file?

The repository deliberately never parses transcripts today.

## Options and recommendation

- A. Yes, counts only, never content: The hook adds up each message's usage numbers and discards everything else; a test asserts transcript text never reaches output or the ledger; a written exception to the no-transcripts rule.
- B. No transcripts: the reconcile pass only: Keep the rule absolute.

Recommended: Yes, counts only, never content. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
