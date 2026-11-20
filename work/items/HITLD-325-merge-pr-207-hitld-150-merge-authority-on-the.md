---
id: HITLD-325
title: "Merge PR #207 (HITLD-150), merge authority on the pull-request path"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: Sounds good. Merge it
answered_at: 2026-11-16T16:13:16.718Z
answered_via: chat
answered_by: owner
---

## Question

Merge PR #207 (HITLD-150) at head 042ed64: tracker-only pull requests may merge without asking once their checks pass, everything else waits, with the owner's five rules?

All 11 checks green including CodeQL; mergeable clean; the owner read the what-merges table. The plugin hooks folder stays with core.

## Options and recommendation

- A. Merge it: Squash-merge at head 042ed64.
- B. Change something first: D-22 changes the branch and a new head is checked.

Recommended: Merge it. All checks green and the owner answered the open questions.

## Answer

Recorded in the front matter once answered.
