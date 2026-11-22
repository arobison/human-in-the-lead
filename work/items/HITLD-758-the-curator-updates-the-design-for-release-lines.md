---
id: HITLD-758
title: The curator updates the design for release lines
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

A curator pass for the design of release lines decided in HITLD-752 (decisions HITLD-753 to 757), a design pull request for the owner's own yes. Touches the release part of the data model (part 3, Release) and the packaging part (16, Release mechanics), and the open question list if one applies.

## Done when

- The design text describes a release line: declared in `policy.json` with a name, a tag template, a surface file and a version source; a project names its line; none declared means the single repository-wide line as today.
- It describes tag templates (default `{name}@{version}`, with `{version}`-only for the legacy shape), that `hitld work check` refuses templates that could match the same tag, and that tag matching reads the line's template.
- It describes the interface delta as a diff of the line's committed surface file between the last tag and now (added lines only: minor; a removed or changed line: major, minor while 0.y.z; no change: patch), with the owner still confirming minor and major.
- It describes `--line` on `release propose` and `release make` (required when more than one line is declared), release records under `work/releases/<line>/`, and a release item unique per line and version.
- It describes the migration of the existing repository-wide releases into a named `main` line, and states how already-published tags stay resolvable for projects that pin them.
- The change reaches main through a design pull request with the owner's own yes. `hitld work check` and the spelling check pass.
