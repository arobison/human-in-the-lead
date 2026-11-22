---
id: HITLD-759
title: "Build release packages: policy-declared packages, tag templates, surface-file deltas, --package, dependencies, groups, trains, channels and migration"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

The build for release packages (design HITLD-752; decisions HITLD-753 to 757 and 760 to 762; GitHub issue 465). It needs the design text first (HITLD-758). No consuming project has published tags or releases, but HITLD's own `v0.1.0-rc.1` tag and record exist and consuming projects pin that tag, so the migration must keep it resolvable and write nothing without the owner's own turn.

## Done when

- `policy.json` can declare release packages (name, tag template, owned paths, surface file, version source, optional `depends_on` ranges, lockstep group, pre-release channels), validated by a schema; `hitld work check` refuses templates that could match the same tag, a milestone or release item naming a package that is not declared, and dependency cycles.
- `release propose` and `release make` take `--package`; a record is written under `work/releases/<package>/` and pins the exact versions of the packages it depends on; a release item is unique per package and version; tag matching and the latest-tag lookup read the package's template.
- `release propose` measures the interface delta from the package's committed surface file between the last tag and now, with the bump rules in HITLD-752, and lists every package that depends on one with a breaking change.
- Lockstep groups share one version; a release train item that needs several packages' release items gates a coordinated release with one owner approval; pre-release channels keep their own counters.
- An item's package is derived from the files it touches.
- A migration moves the existing repository-wide records into a named `main` package and keeps `v0.1.0-rc.1` resolvable; it changes nothing until the owner's own turn.
- Tests cover two packages in one repository with different templates, a package with no declared surface file, a dependency and its dependents list, a lockstep group, a release train and the migration; `npm run check`, the offline eval gate and `hitld work check` pass.
