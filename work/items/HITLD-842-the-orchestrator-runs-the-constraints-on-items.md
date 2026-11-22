---
id: HITLD-842
title: The orchestrator runs the constraints-on-items migration on main once the HITLD-767 pull request has merged
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-767]
---


## Why

The owner decided (HITLD-767 migration question, 2026-11-22) that the orchestrator runs the migration on main after pull request 515 merges, as its own reviewable migration commit at a quiet moment for tracker pull requests. `hitld work migrate constraints-on-items` rewrites 345 tracker files (27 milestones and 318 items); it refuses executors and any branch but main. HITLD-767's own Done-when line said to run it in the same pull request; this item replaces that line.

## Done when

- After pull request 515 merges the orchestrator runs `hitld work migrate constraints-on-items --dry-run`, then the migration, on main, and `hitld work check` passes with both forms read.
- The chief of staff holds new tracker pull requests during the window and refreshes open ones afterwards (merge main into the branch, keep both sides).
- The migration commit reaches main only through a pull request the chief of staff opens, which the owner has authorized by this decision.
