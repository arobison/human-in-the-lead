---
id: HITLD-1043
title: Four small findings from the review of the queue's private-term check (pull request 643) are fixed
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The test that checks the `next` text for the no-list wording matches the wording the code now gives (`was not read for this run`), and fails if the old text comes back.
- When the only refusals on a branch are non-term rules on a path that holds a term, the follow-up does not print an empty list; it says a file whose path holds a private term was refused for another rule.
- Several term-bearing paths are told apart in `problems` and the follow-up by a count, without printing any of them.
- A multi-pull-request test through the command pins `list_found` as one value for the whole run.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The independent review of pull request 643 (HITLD-824) approved it with these four findings, all low: a test pattern that can no longer match [Certain], an empty list in a follow-up in an unreachable case [Likely], identical hidden-path lines [Likely], and a multi-pull-request test that drives the queue directly and not the command [Likely]. The owner chose to merge and file them.

## Notes

rc.3. Merge-queue code: the owner's own yes at merge. Follows HITLD-824.
