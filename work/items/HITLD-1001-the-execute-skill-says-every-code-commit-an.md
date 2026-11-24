---
id: HITLD-1001
title: The execute skill says every code commit an executor makes carries the Dispatch and Agent-Role trailers, or the dco check fails the pull request
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when

- The execute skill, in its start step and not only the close step, says every commit the executor makes on its branch carries the `Work-Item`, `Dispatch` and `Agent-Role` trailers (the DCO check in pull-request mode accepts an agent commit only with `Dispatch:` or `Agent-Role:`), and that a commit already pushed cannot be fixed by a later commit.
- The brief's standard text (orchestrator start message) repeats it in one line, and says the trailers hold the model values the executor is given even where its own rules bar model names in commits (a model trailer is not a model name in prose).
- `hitld work close` or the dispatch report check names a branch commit without the trailers before the executor reports done, so the failure is found by the executor and not by the merge queue; a test covers a branch with one untrailered commit.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-935's pull request 594 sat out of the merge queue from 03:02Z to 03:16Z on 2026-11-24 because two of its commits had no `Dispatch:` or `Agent-Role:` trailer. Nothing told the executor those trailers were needed on every commit, and its brief arrived late. A pushed commit cannot be fixed without rewriting history, so the cost was a new branch and a new pull request. Serves the owner, who waits on the queue.

## Notes

rc.2. Found by the chief of staff on 2026-11-24 while reading why PR 594 never appeared in a merge pass; the owner chose a new branch with one squashed commit as the fix for that pull request. Changes a skill, so it needs the owner's own yes at merge.
