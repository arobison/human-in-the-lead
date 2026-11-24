---
id: HITLD-856
title: The executor guard reads command text, so an executor can still rewire its push remote or its remote refs
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-69 c2]
---

## Done when



- An executor cannot change where its push goes by editing git configuration: `git config remote.origin.url` (and `pushurl`, `insteadOf`), editing `.git/config` or the worktree's config file directly, and `git remote add`, `set-url`, `rename` or `remove` are refused to executors, or the project remote's address is recorded where an executor cannot change it and the push guard checks against that record.
- An executor cannot move `refs/remotes/origin/HEAD` or other remote-tracking refs with `git symbolic-ref` or `git update-ref`, which would make its claim look merged and shed the checkout guard.
- A test covers each refused write and that the allowed claim-branch push (HITLD-793) still works.
- The plugin copy matches. A guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-793 (the executor guard allows pushing the executor's own claim branch and nothing else) hardens the push guard: it allows only `git push [-u] origin <the checked-out claim branch>` and refuses the push when git configuration rewires origin. But the guard reads the text of a command. The executor that built it reported that an executor can still point origin elsewhere by running `git config remote.origin.url` or by editing `.git/config`, and can move `refs/remotes/origin/HEAD` with `git symbolic-ref` or `git update-ref`, which makes its claim look merged and sheds the checkout guard. A pushed branch never changes main without the merge queue, the checks and the owner's yes, so the exposure is narrow, but the guard should not rest on text alone.

## Notes

Raised by the HITLD-793 executor as a follow-up question; filed by the chief of staff on 2026-11-22. Build it after HITLD-793 lands. It is a guard change, so it needs the owner's own yes.
