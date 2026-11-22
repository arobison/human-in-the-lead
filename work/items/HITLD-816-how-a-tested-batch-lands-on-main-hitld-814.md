---
id: HITLD-816
title: How a tested batch lands on main (HITLD-814)
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Per-branch squash commits, rebase-merged; fall back if disallowed: One squashed commit per branch (its Closes line and the owner's sign-off), landed with Rebase and merge; falls back to a merge commit, then to one squash commit, and says which setting would enable the better one."
answered_at: 2026-11-22T06:22:48.044Z
answered_via: question-tool
answered_by: owner
---

## Question

How does the tested batch land on main?

The owner asked whether the batch could keep each branch's already squashed commit, as a normal merge would.

## Options and recommendation

- A. Per-branch squash commits, rebase-merged; fall back if disallowed: One squashed commit per branch (its Closes line and the owner's sign-off), landed with Rebase and merge; falls back to a merge commit, then to one squash commit, and says which setting would enable the better one.
- B. Merge commit for the batch only: Keeps commits, non-linear history.
- C. One squash commit for the whole batch: No settings change; partial revert only.

Recommended: Per-branch squash commits, rebase-merged; fall back if disallowed. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
