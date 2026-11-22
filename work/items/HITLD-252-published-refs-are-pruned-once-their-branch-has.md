---
id: HITLD-252
title: Published refs are pruned once their branch has merged
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-243, HITLD-153]
constraint_of: [HITLD-191 c3]
---

## Why

Ordering (the owner, in the chief of staff session): this waits for HITLD-153, so the planner builds the fix for a finished-but-unmerged item holding a slot first. It is an ordering choice, not a technical dependency.

`refs/hitld/published/*` pile up, and each `work publish` reads all of them. PR #186 batches the reads, but the list still grows. The owner decided (HITLD-248) to prune the refs whose branch has merged to main.

## Done when

- The sweep (or the post-merge cleanup) removes a `refs/hitld/published/*` ref once its branch is merged to main, and reports how many it removed.
- A ref whose branch is not merged, or whose merge cannot be determined, is kept.
- A test covers a merged ref (removed), an unmerged one (kept) and one that cannot be checked (kept, reported).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the owner's decisions on the open questions in the Windows pull request (PR #186, HITLD-243). Needs HITLD-243: the pull request changes the same code.
