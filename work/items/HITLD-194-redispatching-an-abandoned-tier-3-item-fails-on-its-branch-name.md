---
id: HITLD-194
title: Dispatching a tier-3 item again after an abandon fails because its branch name is taken
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
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
