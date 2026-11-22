---
id: HITLD-949
title: The release App creates the tag; its key lives only in the release environment
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: A release App; its key only in the release environment
answered_at: 2026-11-22T21:23:19.862Z
answered_via: question-tool
answered_by: owner
---

## Question

How does the release create its tag (forge decision 6 of 8)?

Short-lived scoped tokens; only an approved main job can mint one.

## Options and recommendation

- A. A release App; key only in the release environment: Short-lived tokens.
- B. A write deploy key in the environment: Long-lived.

Recommended: A release App; key only in the release environment. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
