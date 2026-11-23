---
id: HITLD-797
title: "A milestone and a project show derived progress from their items: not started, in progress, check due or done, with counts"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-192 c?]
---

## Why

The owner noticed that milestones are never shown as in progress while some of the items that feed them are. By design (data model, milestone lifecycle) a milestone has no stored `in-progress` state ("items are claimed, milestones are not"), and main never shows an item `in-progress` because a claim exists only on the executor's branch. Nothing derives the missing view: a milestone shows only `planned` until its constraints are all done (`check_due`). Storing the state would put every claim into the shared milestone file and bring back the merge conflicts HITLD-767 removes, so progress is derived, never stored.

## Done when

- The read API (`hitld work query`) and the dashboard data contract (HITLD-691) return, for each milestone and each project, a derived `progress` with a state (`not_started`, `in_progress`, `check_due`, `done`) and the counts of constraints done, claimed (read from claim branches and the ledger's in-flight dispatches) and total; nothing is written to any file.
- A milestone is `in_progress` when at least one constraint is claimed or done and the milestone is not `check_due` or `done`; it is `not_started` otherwise.
- HITLD's own views and the generated page show it, and `hitld work check` is unaffected.
- A schema change to the contract raises or keeps the `api_version` by its own rule (an added field keeps it). Tests cover each state, a constraint claimed on a branch, and an item in two milestones. `npm run check`, the offline eval gate and `hitld work check` pass.

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-973 (2026-11-23).
