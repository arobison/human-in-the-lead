---
id: HITLD-194
title: Dispatching a tier-3 item again after an abandon fails because its branch name is taken
kind: work
state: done
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-404 c3]
claimed_by: D-53
release_note: An item dispatched again after its tier-3 dispatch was abandoned now starts. When its branch name is taken, `hitld dispatch start` reuses the branch only if nothing on it is unmerged and no worktree has it checked out, and otherwise takes `<name>-2`, leaving the old branch as it is; it says which (`branch_found`, `branch_chose`, `branch_note`).
---

## Why

When a tier-3 dispatch is abandoned and the item is dispatched again, the new worktree reuses the earlier branch name and `git worktree add -b` fails because the branch already exists. The orchestrator hit this at D-3 in the first self-hosted run and worked around it with `hitld env cleanup --result merged` on an untouched branch. It was true before HITLD-130's change to worktree removal and is not fixed by it.

## Done when

- A second dispatch of an item whose earlier dispatch was abandoned starts, either on a fresh branch name or by reusing the existing branch when nothing on it is unmerged.
- A branch holding unmerged commits is never deleted or reset by the second dispatch; the dispatch says what it found and which it chose.
- A test covers abandon then re-dispatch, with and without commits on the old branch.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Reported by orchestrator orch-1 (relay 2026-11-16) and filed under HITLD-181. Related to HITLD-130 (merged worktrees are removed).

## Built (D-53)

- `chooseBranch` in `core/lib/env/worktree.mjs` settles the branch a new worktree takes. A free name is used as it is. A taken name whose local and remote-tracking tips are all in the base, and which no worktree has checked out, is reused: `git worktree add -B` moves it to the base's tip, which loses no commit. Otherwise (unmerged commits, or still checked out in an abandoned or failed worktree) the branch is left as it is and the worktree takes the first free `<name>-2`, `<name>-3`, ... `createWorktree` runs it under the registry lock and logs what it found.
- `hitld dispatch start` settles the name for tier 3 before the dispatch is written to the ledger, so the ledger's `dispatched` event, the brief and the instruction carry the branch the worktree got, and passes that exact name to `createWorktree` (a mismatch is refused as `setup-failed`). The result carries `branch_found`, `branch_chose` and `branch_note` when the name was taken. Passing the exact name also ends a latent mismatch: the worktree code cut its own slug at 40 characters, the orchestrator's did not.
- The usual case is the refill dispatching the item at once after the watchdog abandons it: the old worktree is still there (the teardown runs before the abandon), so the second dispatch takes `-2`. After the teardown, a branch with nothing on it is already deleted (HITLD-130) and the name is free again.
- Tests: `core/test/env.test.mjs` (reuse, unmerged, checked out, remote-tracking) and `core/test/watchdog.test.mjs` (abandon by the watchdog, then re-dispatch: at once, after the teardown, and with a commit on the old branch). Design part 13.2 says how the name is settled.
- After review: a claim the old branch made keeps the item out of the queue (`not-planned`) until the orchestrator gives it up with `hitld work unclaim` on main, as design 3.4 already says. The watchdog's abandon step and the orchestrate skill now say so, and a test runs claim, abandon, unclaim, re-dispatch and claim through `work check`. The claim lookup is not taught the ledger: it reads git only, and a second way to retire a claim beside the `unclaim:` commit would split design 3.4. The `worktree_created` event carries the dispatch's reason for a fresh name. Running out of names is the coded refusal `branch-names-taken`, before the ledger write. A remote whose name holds a slash no longer hides its tip.
