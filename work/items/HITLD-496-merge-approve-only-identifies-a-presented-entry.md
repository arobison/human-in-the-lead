---
id: HITLD-496
title: merge approve --only identifies a presented entry by item, and a branch rename keeps its queue entry
kind: work
state: proposed
created: 2026-11-18
project: HITLD-15
constraint_of: [HITLD-404 c2]
---

## Done when

- `hitld merge approve --only <item ID>` identifies the presented entry by item, whatever its branch is called, since the presentation already binds each item to its branch and commit.
- A branch rename keeps the queue entry, or hitld has a command that moves an entry to a new branch name without a re-report from the executor.
- A test presents two entries, one of them on a harness-named branch, and records an approval for one by item. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reported in GitHub issue #202. Two items passed the merge queue together and the owner approved one. `merge approve --only <item>` and `--only <branch>` both refused with `ambiguous` ("on a branch other than the one its item was dispatched on"), because the executors' branches still had the harness's names after the executor hook refused the rename the brief asks for (#149, tracked). The way out was costly: renaming the branches removed both entries from the queue (it tracks them by branch), so each executor had to report again and the whole queue ran again before a fresh batch could be presented.

## Notes

Triaged 2026-11-18: proposed. Related: #149 (the hook refusing the rename, tracked; fixing it removes the trigger), #150, HITLD-494, HITLD-495. As with HITLD-494, check whether the pull-request merge path has the same failure before building. Code: the owner's own yes to merge.

Added 2026-11-24 from GitHub issue 630 (closed as a duplicate of 202 and 297): in one batch of two items, verification passed on harness-named branches and two merge approvals did nothing; the items were dispatched again with no code change, verified on hitld-named branches, and only then merged, after the owner approved three times. An approval applies to the branches the owner was shown, whatever they are named; if it cannot, hitld says so.
