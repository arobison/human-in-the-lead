---
id: HITLD-1028
title: "Merge PR 622: early owner approvals apply only to a head git itself would produce (HITLD-821)"
kind: decision
state: done
created: 2026-11-24
project: HITLD-15
decider: owner
answer: "A. Approve: The queue merges it once its checks pass."
answered_at: 2026-11-24T14:56:56.406Z
answered_via: question-tool
answered_by: owner
---

## Question

Approve PR 622 for merge?

The exact-tree check replaces the diff-text tolerance. An independent review ran the attack cases and found no bypass; tests pass and fail without the check. It touches the merge guard and adds a public error code.

## Options and recommendation

- A. Approve: The queue merges it once its checks pass.
- B. Hold it: Leave it unmerged.

Recommended: Approve. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
