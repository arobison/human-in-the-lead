---
id: HITLD-821
title: An owner approval can be recorded for a pull request head before the queue presents it, and applies when it does
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M860KRCVC4M0YF
release_note: "`hitld merge approve --only <branch> --head <sha> --signoff <sign-off>` records the owner's approval of an open pull request's head before the queue presents it (merge.via pull-request); the queue applies it when it presents that head, or that head with only merges of main after it, and drops it otherwise. A branch with no open pull request is refused with the new error code `no-pull-request`."
---

## Why

`hitld merge approve` refuses with not-presented until the orchestrator has run `hitld merge` and presented the pull request. On 2026-11-22 this cost a round trip for each of five pull requests: the owner answered, the approval could not be recorded, the orchestrator presented, and then the approval was recorded. A store pull problem made it worse (the chief of staff could not even see the presentation).

## Done when

- `hitld merge approve --only <branch> --head <sha>` records an approval for that exact head before the queue presents it; the queue applies it when it presents that head and drops it if the head moved by anything but main (HITLD-777 rules).
- It is refused for a branch with no open pull request, and says so.
- Tests cover approving before presentation, a head that moved, and an approval for a branch that never presented. A queue and rights change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
