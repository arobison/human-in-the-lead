---
id: HITLD-811
title: Merge pull request 494 (HITLD-763) directly, because the queue was blocked by the bug it fixes
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Yes, merge 494 directly: The chief of staff verifies head and checks and squash-merges it; the other approved pull requests go through the queue."
answered_at: 2026-11-22T06:04:47.897Z
answered_via: question-tool
answered_by: owner
---

## Question

May the chief of staff merge the already approved pull request 494 directly on GitHub?

The store export committed executor worktrees as gitlinks and broke the store pull, so the merge queue could not apply the owner's approvals, including 494's own. 494 fixes that. Its head e2c24e8 had all twelve checks green, and main had moved only in tracker files.

## Options and recommendation

- A. Yes, merge 494 directly: The chief of staff verifies head and checks and squash-merges it; the other approved pull requests go through the queue.
- B. No, wait for HITLD-729 to finish: Orch-6 retries when the worktree ends.
- C. Let orch-6 go on without the store (--no-sync): The owner types that approval in the orchestrator's session.

Recommended: Yes, merge 494 directly. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
