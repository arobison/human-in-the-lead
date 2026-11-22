---
id: HITLD-745
title: Find out why the planner offers an item again after it was claimed and finished
kind: work
state: done
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M810DRE9WHD3YD
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

## Finding (D-01M810DRE9WHD3YD, 2026-11-22)

The issue's cause is wrong. Claims are not found by a branch-name pattern: `findClaims` (`core/lib/tracker/files/claims.mjs`) reads every ref under `refs/heads/` and `refs/remotes/` (`refPlaces` in `tree.mjs`) and counts an item as claimed while it is `in-progress` on a ref. The repeat has two other causes, and the two items in the report show one each. Neither is a claim that is not read.

**After every completion: the planner reads a checkout the pull-request merge never moves.** `readyQueue` (`core/lib/cli/commands/orchestrator.mjs`) takes the ready set from `readWorkItems`, which reads the item files in the orchestrator's working tree (`loadWorkTree`). With `merge.via` set to `pull-request` (every cloud session), `hitld merge` squash-merges on GitHub and fetches `main` into `refs/remotes/origin/main` only (`core/lib/merge/pull-request.mjs`); nothing moves the local `main` or its files. The merge records `merged`, which ends the item's wait in `awaitingMerge`, and the dispatch already left `in_flight` on `reported`. The executor's claim stopped counting when it closed the item on its branch (`done` is not `in-progress`). So the working tree still says `planned`, no claim, nothing in flight and nothing awaiting merge: the item is ready again until someone pulls `main`. This is the planner, fed a stale copy of the tracker.

Reproduced with a test, run here and not committed because it fails on `main` (the fix item below makes it its first step). In a consumer with `merge.via: pull-request`, mode `queue`, a bare remote and `fakeGitHub`: `dispatch start W-1`, then `work claim`, a code commit and `work close` on the branch, push, `dispatch complete` with a done report, `hitld merge` (merged `["W-1"]`), then `dispatch plan`. Result: `origin/main` holds W-1 `done`, the checkout holds it `planned`, and the plan's start list is `["W-1","W-2"]` with `awaiting_merge: []`. The same test with `git merge --ff-only origin/main` before the plan passes: the start list is `["W-2","W-3"]`.

**HITLD-30: an item that its pull request did not close.** PR 395 (`f5730ef5`) was squash-merged on GitHub by hand, outside the merge queue (committer GitHub; message trailers `Dispatch: D-45`, `Agent-Role`, `Agent-Model`, `Signed-off-by`, and no `Work-Item:`). Its branch, `hitld/HITLD-30-reproducer-reported-bugs-to-failing-tests`, has no claim commit and no close: the item file is unchanged on it since `97cb817e`. The merge queue would have sent it back (`not_closed` in `pull-request.mjs`), but it was not used. So `main` kept HITLD-30 `planned` from 2026-11-20 until the chief of staff closed it by hand in #458 (`02086ad6`, 2026-11-21), and every plan in between offered it, correctly by the tracker's word. Nothing caught it: `hitld work check` on `main` at `02086ad6^` lists ten trailer mismatches and none is HITLD-30, and `hitld work sweep` there finds one `merged-but-open` and it is not HITLD-30. Both look for a `Work-Item:` trailer (the sweep also takes a ledger `merged` event, which a merge outside the queue does not write), and the squash message had none.

**HITLD-167: neither; an item that is ready and out of scope.** HITLD-167 is `planned` (or `proposed`, on older refs) on every ref of the clone, with no `claimed_by` and no claim or close commit anywhere in its history; its one need, HITLD-135, is `done`. It was never claimed or finished. The planner offers it because the tracker says it is ready and the planner knows nothing of the owner's commitment, which keeps it out of the start list only in prose ("stays out of the orchestrator's start list until the owner names it"). That is HITLD-278, already filed.

**Fix item, described for the orchestrator to file** (an executor cannot run `hitld work new`): "The planner reads the tracker from a checkout the pull-request merge never moves, so a merged item is offered again". Why: the first cause above, with this reproduction. Done when: a test as above (merge through pull requests, then `dispatch plan` and `dispatch start` on the merged item) fails first, then passes because the ready set is read from the main branch the merge fetched (or the checkout is brought up to it) rather than from a stale working tree; the local merge path keeps working; `npm run check`, the offline eval gate and `hitld work check` pass. A second, smaller one may be worth filing for the HITLD-30 case: a squash on `main` that carries `Dispatch:` and names an item in its subject, with no `Work-Item:` trailer, is not seen by `work check` or the sweep.
