---
id: HITLD-1025
title: Release items stay open until the release publishes (PR 616, HITLD-838)
kind: decision
state: done
created: 2026-11-24
project: HITLD-15
decider: owner
answer: "B. Done when published: Safer; the release item is closed by hand after a successful publish. PR 616 needs a larger rework."
answered_at: 2026-11-24T06:50:31.550Z
answered_via: question-tool
answered_by: owner
---

## Question

When is a release item counted done: at the record commit, or only once the release has published?

PR 616 closes release items automatically. Owner chose the safer rule: closing happens after publishing succeeds, because releases are infrequent and a failed publish should not leave items wrongly closed.

## Options and recommendation

- A. Done at the record commit: Less hand work; hand reopen if a release fails after the commit.
- B. Done when published: Safer; the release item is closed by hand after a successful publish. PR 616 needs a larger rework.

Recommended: Done at the record commit. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
