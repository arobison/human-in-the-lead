---
id: HITLD-999
title: The stuck-merge fix flag checks its item and cannot exceed the cap twice, and an item whose pull request closed unmerged is not hidden from the planner
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `dispatch start --fixes-merge <item>` refuses unless the item being started is the fix for that item's stuck merge (its own branch, or an item whose notes name it), and it never takes a second slot past the cap, including together with `--by-hand` before setup is done; a test covers a plain ready item, an unrelated awaiting item and `--by-hand` with `--fixes-merge`.
- An item whose last verified-pass branch was closed unmerged is released to the planner again once its pull request is closed, with no `corrects` record from the owner; a test covers a closed-unmerged pull request, a deleted remote branch and a stale remote-tracking ref.
- The skill sentence on the extra slot says what happens on a harness without parallel subagents.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-978 gave a stuck-merge fix one slot past the cap and hid items waiting to merge. The independent review of its pull request on 2026-11-24 found two gaps the owner chose to accept and file: the flag does not check that the item relates to a stuck merge, so any ready item can exceed the cap by one; and an abandoned pull request can hide an item until the owner appends a correction. Serves the owner, whose cap and planner should hold as stated.

## Notes

rc.3. Moved from rc.2 on 2026-11-24 at the owner's word: review polish, not a ship blocker. From the review of pull request 593 (HITLD-978), accepted by the owner on 2026-11-24 with the gaps filed here. Review doubts to check while here: a past-cap start refused with `cap` after its dispatch events were written (person and machine max_executors); `closedOnBranch` reading a pre-migration branch file as not done; `dispatch start` reading the ready queue twice; other callers of awaitingMerge (digest, status) using the old rule.
