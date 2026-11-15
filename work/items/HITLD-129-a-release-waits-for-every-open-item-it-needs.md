---
id: HITLD-129
title: "A release waits for every open item it needs, not only milestones"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

`hitld release propose` and `release make` count only the milestones a release item needs as gates. Items in its `needs` are never checked, so a release could be made while work it waits for is still open. The owner decided this is fixed before v0.1.0-rc.1.

## Done when

- `hitld release propose --item <ID>` lists, as gates, every item and milestone the release item needs that is not done or dropped (an item by its state; a milestone by its passing check, as today), each with its ID, title and state.
- `hitld release make --item <ID>` refuses while any gate is open, naming them, and the release workflow's record check (`core/bin/release-check.mjs`) applies the same rule, so a record made by hand cannot skip it.
- Without `--item`, behavior is unchanged.
- Design 3.2 ("Milestones and releases") and 16.5 (release mechanics) say so; tests cover an open item, a dropped item, an open milestone, and all done.
- `npm run check`, the offline eval gate and `hitld work check` pass.
