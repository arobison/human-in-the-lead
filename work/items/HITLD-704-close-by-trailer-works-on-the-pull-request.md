---
id: HITLD-704
title: Close by trailer works on the pull-request merge path
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

Close by trailer (HITLD-49, PR 398) runs only in the local queue's queue and owner modes (`core/lib/tracker/files/closing.mjs`). This repository merges with `merge.via: pull-request`, where GitHub squash-merges the branch and its squash message drops any `Closes:` trailer, so the trailer never closes an item here. Executors must still run `hitld work close` in their own branch, which is the step the trailer was meant to make unnecessary for work done outside dispatch. HITLD-49 was described as removing that step; on this path it does not.

## Done when

- With `merge.via: pull-request`, a pull request whose branch commits carry `Closes: <ID>` has that item closed by the merge itself: either the squash message carries the trailer so the same close and the consistency check see it, or the queue commits the item's Done edit as part of the merge. The build says which it chose and why.
- Reverting that merge reopens the item, as for a local merge (HITLD-49, first line of its Done when).
- `Refs: <ID>` never changes state on this path either, and a branch that already closed its own item with `hitld work close` is not closed twice or refused.
- A test against the fake GitHub API covers a pull request with `Closes:` (the item is closed by the merge), one with `Refs:` (it stays open) and one whose branch already closed the item.
- Design 3.4 and 14.2 say that close by trailer covers the pull-request path, through the curator job and a design pull request.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Reported from the first self-hosting run (the executor report on PR 400). Code and design: the owner's own yes to merge. Related: HITLD-49 (done), HITLD-133 (merging through pull requests), HITLD-218 (the squash trailers the chief of staff writes).
