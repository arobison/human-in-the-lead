---
id: HITLD-777
title: The merge queue does not update or recheck a branch when main moved only under work/
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M80RAYWZYGR1JT
---

## Why

Found in the first self-hosting run: the merge queue (owner mode, pull-request path) brings a presented branch up to date with main and restarts its named checks every time main moves. The owner's rule is that tracker-only changes are merged out of band from the queue, so each tracker merge moved main and restarted the checks of the queued code pull request. PR 464 was updated three times in a row and could not land while tracker pull requests kept merging, a livelock the orchestrator reported.

## Done when

- The queue does not update a branch from main, or restart its checks, when everything that changed on main since the branch's base is under `work/` and the branch itself changes no file under `work/` that main also changed.
- A change on main outside `work/`, or a `work/` file the branch also changes, still triggers the update and the recheck as today.
- A test shows a presented branch merging while tracker-only merges land on main, and a branch being updated when a code change lands.
- `npm run check`, the offline eval gate and `hitld work check` pass.
