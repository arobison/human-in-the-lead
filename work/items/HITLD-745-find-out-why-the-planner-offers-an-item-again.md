---
id: HITLD-745
title: Find out why the planner offers an item again after it was claimed and finished
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

Reported as GitHub issue 431: the planner offers an item again after it was claimed and finished. The issue gives a cause, a branch-name pattern, that looks wrong, because claims are read from all refs (`hitld work claims`), not by a branch name. In the run behind the report the planner kept proposing HITLD-30, whose tracker item was never closed by the pull request that delivered it, and HITLD-167. The cause may be an item left open, a claim that is read wrongly, or a merged branch whose claim no longer counts. Fixing the wrong cause would leave the symptom.

## Done when

- The cause is reproduced first: a test that makes the planner offer an item again after its claim and its delivery, or a written finding (in this item's notes) of the actual cause, with the evidence for each of HITLD-30 and HITLD-167.
- The finding says whether the stale offer comes from the planner, from a claim that is not read, or from an item that its pull request did not close, and files a fix item for that cause.
- `hitld work check` passes.

## Notes

Proposed, not in a milestone: reproduce before anything is built. Related: HITLD-278 (the planner's scope), HITLD-710 (the watchdog and a claim it leaves), HITLD-194 (the unclaim command).

## Promoted on 2026-11-22

Promoted to planned: reproduce first. Evidence from the first run: the planner kept proposing HITLD-30 (the PR that delivered it never closed it) and HITLD-167, and consumers report the repeat after every completion (issues 151, 159, 431).
