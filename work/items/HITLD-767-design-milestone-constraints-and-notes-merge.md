---
id: HITLD-767
title: "Design: milestone constraints and notes merge cleanly when two tracker pull requests edit the same milestone"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

Two tracker pull requests that both add constraints and notes to the same milestone conflict, because a milestone's constraints are one long line in its front matter and notes are appended at the end. Three such conflicts occurred in one session (HITLD-67), each resolved by hand. Options to weigh with the owner: one constraint per line so git merges appends, a union merge attribute for `work/milestones/**`, or a command that adds a constraint to a milestone (HITLD-276 is the related request).

## Decided on 2026-11-22 (owner, HITLD-784 and HITLD-785)

The link between an item and a milestone clause lives on the item, as `constraint_of: [HITLD-67 c2]`, and a milestone's constraints are derived from its items, so a pull request that files an item edits only that item's file and never the milestone. Dated notes about why an item joined move to the item's own Notes. This reverses the earlier choice (HITLD-82) to keep the link only in the milestone file; the read API already returns `constraint_of`. The move is made by `hitld work migrate constraints-on-items`; until a tracker is migrated both forms are read (the item side wins) and `hitld work check` warns that the milestone-side list is retired; the milestone-side reading is removed in rc.3.

## Done when

- An item's `constraint_of` names a milestone and a clause that exists; `hitld work check` refuses one that does not, and derives each milestone's constraints, clause coverage and release closure from the items.
- While a milestone still has a `constraints:` line, it is read as well, the item side wins, and `hitld work check` warns that it is retired.
- `hitld work migrate constraints-on-items` moves every link into its item, deletes the milestone's `constraints:` line, and is idempotent; it is run on this repository in the same pull request.
- A test shows two branches each filing an item into the same milestone merging without a conflict, and a test covers the migration.
- The design text (the data model's milestone part) is updated in the same pull request, which reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.
