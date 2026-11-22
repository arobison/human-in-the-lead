---
id: HITLD-840
title: A squash commit on main with a Dispatch trailer and an item in its subject but no Work-Item trailer is caught by work check and the sweep
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---


## Why

The HITLD-745 investigation found HITLD-30's pull request 395 merged by hand outside the queue with no close and no Work-Item trailer, so the item stayed `planned` until it was closed by hand in pull request 458. `work check` and the sweep did not notice.

## Done when

- `hitld work check` and `hitld work sweep` flag a commit on main whose subject names an item (or carries a Dispatch trailer) and has no Work-Item trailer or close, naming the item.
- Tests cover the missing trailer and a correct one. `npm run check`, the offline eval gate and `hitld work check` pass.
