---
id: HITLD-306
title: Where the Your move, Proposals and Flow views land
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Merge #196 after review, then HITLD-152: PR #196 stays the milestone board with its proposals table; HITLD-152 then builds Your move, the full Proposals view and Flow, each reviewed by the owner."
answered_at: 2026-11-16T06:03:08.811Z
answered_via: question-tool
answered_by: owner
---

## Question

Dyno's Your move, Proposals and Flow views are in HITLD-152 (the four-view dashboard), not in PR #196 (the milestone board). Where should they land?

The owner said the dashboard is missing a bunch of the work page: your move, flow, proposals.

## Options and recommendation

- A. Merge #196 after review, then HITLD-152: PR #196 stays the milestone board with its proposals table; HITLD-152 then builds Your move, the full Proposals view and Flow, each reviewed by the owner.
- B. Add them to #196 before merge: D-20 builds all four views into #196: one big review, a larger PR, a later merge.
- C. Hold both until I decide: Nothing merges and nothing more is built until the owner walks through the page.

Recommended: Merge #196 after review, then HITLD-152. Keeps the PR reviewable and frees the idle executor slot sooner.

## Answer

Recorded in the front matter once answered.
