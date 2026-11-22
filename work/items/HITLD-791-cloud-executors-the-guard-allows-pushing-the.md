---
id: HITLD-791
title: "Cloud executors: the guard allows pushing the executor's own claim branch"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Allow pushing exactly the executor's own claim branch: git push of the checked-out hitld/<item> claim branch to the project remote and nothing else: never main or another branch, never a force push, a delete or a tag."
answered_at: 2026-11-22T05:08:56.871Z
answered_via: question-tool
answered_by: owner
---

## Question

Once the guard runs in cloud executor sessions it denies every executor git push; what should it allow?

A cloud executor's work lives only in its own container, so someone has to push it; the orchestrator cannot reach that container.

## Options and recommendation

- A. Allow pushing exactly the executor's own claim branch: git push of the checked-out hitld/<item> claim branch to the project remote and nothing else: never main or another branch, never a force push, a delete or a tag.
- B. Executors never push; the chief of staff pushes: Keeps the old rule; no way to make it work in the cloud.

Recommended: Allow pushing exactly the executor's own claim branch. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
