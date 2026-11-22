---
id: HITLD-758
title: The curator updates the design for release packages
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M810EQ2VV1R1RE
---

## Why

A curator pass for the design of release packages decided in HITLD-752 (decisions HITLD-753 to 757 and 760 to 762), as a design pull request for the owner's own yes. It touches the release part of the data model (part 3, Release) and the packaging part (16, Release mechanics), and the open question list if one applies.

## Done when

- The design text describes a release package: declared in `policy.json` with a name, a tag template, the paths it owns, a committed surface file and a version source; an item belongs to a package by the files it touches; a project can span packages; milestones and release items name their package.
- It describes tag templates (default `{name}@{version}`, other shapes such as `{name}/v{version}` or `v{version}`), and that `hitld work check` refuses templates that could match the same tag.
- It describes the interface delta as a diff of the package's committed surface file between the last tag and now (added lines only: minor; a removed or changed line: major, minor while 0.y.z; no change: patch), with the owner still confirming minor and major.
- It describes `--package` on `release propose` and `release make`, release records under `work/releases/<package>/`, and a release item unique per package and version.
- It describes `depends_on` with a version range, release records that pin the exact versions of the packages they depend on, a refusal of cycles between packages, lockstep groups (packages that share one version), the dependents list in `release propose` (every package that depends on one with a breaking change), release trains (one release item that needs several packages' release items) and pre-release channels (rc, beta, alpha counters per package).
- It describes the migration of the existing repository-wide releases into a named `main` package and states how the already-published tag `v0.1.0-rc.1` stays resolvable.
- The change reaches main through a design pull request with the owner's own yes. `hitld work check` and the spelling check pass.
