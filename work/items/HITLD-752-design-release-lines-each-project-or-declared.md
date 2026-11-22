---
id: HITLD-752
title: "Design release lines: each project or declared line gets its own version, tag namespace, release record and interface delta"
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
---

## Why

GitHub issue 465 asks for independently versioned release lines per project in one repository: today the version, tag matching, release record and public-interface delta are repository-wide, so a monorepo's separately versioned packages collide. The owner decided the model in a walk-through (HITLD-751 and HITLD-753 to 757): a line is declared in policy and projects point at it; each line declares a tag template (default name@version); a line's interface is measured from a committed surface file the project's own tool produces; a project names its line and `release propose` and `release make` take `--line`; and the existing repository-wide releases migrate into a named main line. The owner chose building it in rc.2.

## Done when

- The decisions HITLD-753 to 757 are recorded and the design text states them (HITLD-758 does this).
- The build (HITLD-759) is done.
- `hitld work check` passes.
