---
id: HITLD-752
title: "Design release packages: each package has its own version, tags, release record and interface delta"
kind: work
state: dropped
reason: "Dropped on 2026-11-24 (owner's answer, decision HITLD-1032): the design is decided (HITLD-751, 753 to 757, 760 to 762, 783) and built (HITLD-759), so this design item has no work left."
created: 2026-11-22
project: HITLD-15
---

## Why

GitHub issue 465 asks for independently versioned release units in one repository: today the version, tag matching, release record and public-interface delta are repository-wide, so a monorepo's separately versioned modules collide. The owner decided the model in a walk-through (HITLD-751, HITLD-753 to 757, and the revisions HITLD-760 to 762), aiming for the best design now because no consuming project has published tags or releases yet. The unit is called a package (HITLD-761), the word the monorepo tools use. The driving example is a Cesium branch with several modules that may be versioned separately.

Decided so far: a package is declared in `policy.json` with a name, a tag template, the paths it owns, a committed surface file and a version source (HITLD-753, 754, 755; "line" in those records means package); the default tag template is `{name}@{version}`; a package's interface is measured by diffing its committed surface file between the last tag and now (added lines only: minor; a removed or changed line: major, minor while 0.y.z; no change: patch; the owner confirms minor and major); an item belongs to a package by the files it touches, a project is an outcome and can span packages, and milestones and release items name their package (HITLD-760); `release propose` and `release make` take `--package`; the existing repository-wide releases migrate into a named main package (HITLD-757, owner's choice, with HITLD's own `v0.1.0-rc.1` tag kept resolvable); and the design includes lockstep groups, a dependents list in `release propose`, release trains and pre-release channels (HITLD-762).

Proposed by the chief of staff and confirmed by the owner (HITLD-783): every repository declares at least one package (setup creates it), so there is no implicit unnamed package and no legacy code path; a package declares `depends_on` other packages with a version range; a release record pins the exact versions of the packages it was built against; and `hitld work check` refuses cycles between packages.

## Done when

- The decisions HITLD-753 to 757 and 760 to 762 are recorded and the design text states them (HITLD-758 does this), including the three confirmed points above.
- The build (HITLD-759) is done.
- `hitld work check` passes.
