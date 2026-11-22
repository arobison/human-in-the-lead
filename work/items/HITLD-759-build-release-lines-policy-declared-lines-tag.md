---
id: HITLD-759
title: "Build release lines: policy-declared lines, tag templates, surface-file deltas, --line, and migrating the existing releases"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

The build for release lines (design HITLD-752, decisions HITLD-753 to 757; GitHub issue 465). It needs the design text first (HITLD-758). The owner chose to migrate the existing releases into a named main line: published tags are a one-way door and consuming projects pin them (for example v0.1.0-rc.1), so the migration must keep every published tag resolvable and write nothing without the owner's own turn.

## Done when

- `policy.json` can declare release lines (name, tag template, surface file, version source), validated by a schema; `hitld work check` refuses templates that could match the same tag and a project naming a line that is not declared.
- `release propose` and `release make` take `--line`; a record is written under `work/releases/<line>/`; a release item is unique per line and version; tag matching and the latest-tag lookup read the line's template.
- `release propose` measures the interface delta from the line's committed surface file between the last tag and now, with the bump rules in HITLD-752.
- A migration moves the existing repository-wide records into a named `main` line and keeps every already-published tag resolvable; it changes nothing until the owner's own turn.
- Tests cover two lines in one repository with different templates, a line with no declared surface file, and the migration; `npm run check`, the offline eval gate and `hitld work check` pass.
