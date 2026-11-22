---
id: HITLD-950
title: Require signed commits on main if the queue App's merges pass a one-time test
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Yes, if the one-time test passes: Dropped if the queue's merges are refused."
answered_at: 2026-11-22T21:24:41.883Z
answered_via: question-tool
answered_by: owner
---

## Question

Require signed commits on main (forge decision 7 of 8)?

The owner asked how non-squash merges could be supported later: batching lands each PR by its own squash; otherwise queue-authored API commits, queue signing, or an exemption.

## Options and recommendation

- A. Yes, if the one-time test passes: Dropped if the queue's merges are refused.
- B. No signed-commit rule: No provenance requirement.

Recommended: Yes, if the one-time test passes. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
