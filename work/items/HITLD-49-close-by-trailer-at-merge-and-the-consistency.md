---
id: HITLD-49
title: Close by trailer at merge, and the consistency check on main
kind: work
state: planned
created: 2026-11-14
project: HITLD-15
---

## Why

Work that does not come through an executor (a person fixing something by hand and merging it) can leave its item open. Part 3, "Claims and closing": a `Closes: <ID>` trailer has the merge add the Done edit in the same merge, `Refs: <ID>` links without closing, and `hitld work check` on main flags commits that reference an open item and items closed with no referencing commit. No keyword parsing of commit prose.

## Done when

- A merge (queue or owner mode) of a branch with a `Closes:` trailer commits the item's Done edit in the same merge; reverting the merge reopens it.
- `Refs:` never changes state.
- `hitld work check` reports both mismatches on main, with the commits and items named; the orchestrator skill offers the fix.
- Tests and an offline eval scenario cover a hand merge with `Closes:`, a direct push caught by the check, and a revert.


