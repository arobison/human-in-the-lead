---
id: HITLD-129
title: "Release items carry their version, and a release waits for every open item it needs"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

`hitld release propose` and `release make` count only the milestones a release item needs as gates. Items in its `needs` are never checked, so a release could be made while work it waits for is still open. The owner decided this is fixed before v0.1.0-rc.1.

## Done when

- **A release item carries its version** in a `release` key (for example `release: 0.1.0-rc.1`); milestones stay named by outcome, never by version (design 3.2). `hitld work check` refuses two release items for one version and a `release` value that is not a version.
- `hitld release propose` and `release make` find the release item whose `release` matches the version they propose (or make), and use it as if `--item` named it; `--item` still overrides, and a mismatch between `--item`'s version and the proposed one is refused.
- `hitld release propose --item <ID>` lists, as gates, every item and milestone the release item needs that is not done or dropped (an item by its state; a milestone by its passing check, as today), each with its ID, title and state.
- `hitld release make --item <ID>` refuses while any gate is open, naming them, and the release workflow's record check (`core/bin/release-check.mjs`) applies the same rule, so a record made by hand cannot skip it.
- Without a release item for the version and without `--item`, behavior is unchanged.
- HITLD-128 gets `release: 0.1.0-rc.1` and HITLD-24 gets `release: 0.1.0`.
- Design 3.2 ("Milestones and releases") and 16.5 (release mechanics) say so; tests cover an open item, a dropped item, an open milestone, and all done.
- `npm run check`, the offline eval gate and `hitld work check` pass.
