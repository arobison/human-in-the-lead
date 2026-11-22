---
id: HITLD-883
title: Design how build systems and language ecosystems plug in as data
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---

## Why

Reported as GitHub issue 553 (https://github.com/arobison/human-in-the-lead/issues/553). hitld's support for build systems is uneven and no design says how an ecosystem plugs in. General today: `env.worktree_setup`, `merge.fast_checks` and `merge.full_suite` are plain command lists, and the new-dependency trigger knows nine ecosystems' manifests (`core/lib/merge/owner.mjs`). npm-bound today: `release propose` and settings pins read only a root `package.json`, hitld installs as an npm dev dependency and runs through `npx`, and nothing knows an ecosystem's dependency or output folders, shareable caches, monorepo versioning or registry publishing (a consumer's worktrees took 5.5 GB, each with a full install; the walk failure of issue 549 is one symptom).

## Done when

- A design (a part of the design document, or a design item the curator carries) answers the issue's eight questions: an ecosystem description as data (manifests, lockfiles, version sources, install, build and test commands, dependency and output folders, shareable caches; built-in profiles, never code-running hooks); several ecosystems in one repository; how monorepo tools relate (Rush, Nx, Turborepo, Bazel, Pants, Cargo workspaces, Gradle); worktree setup with shared content-addressed caches; versions and releases beyond `package.json` (Cargo.toml, pyproject.toml, gradle.properties, tags; lockstep and independent lines, with issue 465); evidence from result formats such as JUnit XML; walks that skip what an ecosystem marks as dependencies or output; installing hitld in a project with no Node toolchain.
- The owner's choices are walked through one at a time and recorded as decisions, and the builds that follow are filed as items with their release named.
- `hitld work check` passes.

## Notes

On the owner's word of 2026-11-22 (decision HITLD-878), the design is needed for rc.2. The design is this item; the builds it names are not automatically rc.2 (that is for the owner to decide after the walk-through). The narrow fixes already planned (HITLD-879, the walk skip) and the release version-source reading are the first candidates.
