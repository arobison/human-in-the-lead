---
id: HITLD-883
title: Design how build systems and language ecosystems plug in as data
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-402 c?]
---

## Why

Reported as GitHub issue 553 (https://github.com/arobison/human-in-the-lead/issues/553). hitld's support for build systems is uneven and no design says how an ecosystem plugs in. General today: `env.worktree_setup`, `merge.fast_checks` and `merge.full_suite` are plain command lists, and the new-dependency trigger knows nine ecosystems' manifests (`core/lib/merge/owner.mjs`). npm-bound today: `release propose` and settings pins read only a root `package.json`, hitld installs as an npm dev dependency and runs through `npx`, and nothing knows an ecosystem's dependency or output folders, shareable caches, monorepo versioning or registry publishing (a consumer's worktrees took 5.5 GB, each with a full install; the walk failure of issue 549 is one symptom).

## Done when

- A design (a part of the design document, or a design item the curator carries) answers the issue's eight questions: an ecosystem description as data (manifests, lockfiles, version sources, install, build and test commands, dependency and output folders, shareable caches; built-in profiles, never code-running hooks); several ecosystems in one repository; how monorepo tools relate (Rush, Nx, Turborepo, Bazel, Pants, Cargo workspaces, Gradle); worktree setup with shared content-addressed caches; versions and releases beyond `package.json` (Cargo.toml, pyproject.toml, gradle.properties, tags; lockstep and independent lines, with issue 465); evidence from result formats such as JUnit XML; walks that skip what an ecosystem marks as dependencies or output; installing hitld in a project with no Node toolchain.
- The owner's choices are walked through one at a time and recorded as decisions, and the builds that follow are filed as items with their release named.
- `hitld work check` passes.

## Notes

On the owner's word of 2026-11-22 (decision HITLD-878), the design is needed for rc.2. The design is this item; the builds it names are not automatically rc.2 (that is for the owner to decide after the walk-through). The narrow fixes already planned (HITLD-879, the walk skip) and the release version-source reading are the first candidates.

## Walk-through of 2026-11-22

Decided one at a time: HITLD-886 (data profiles, commands only in policy), 910 (a section of policy.json), 911 (explicit mapping), 912 (version sources in the profile), 913 (JSON, TOML, properties, tags), 914 (monorepos: read versions only), 915 (tool shares caches), 916 (exit status decides), 917 (Node on the machine in rc.2), 918 (the rc.2 slice) and 919 (reproduce issue 549 first). The builds are HITLD-920 to 928; the design text is HITLD-924, which closes this item.

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-972 (2026-11-23).
