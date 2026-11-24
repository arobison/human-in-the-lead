---
id: HITLD-976
title: A pnpm workspace project installs, sets up worktrees, runs its checks and cuts a release with HITLd
kind: work
state: done
created: 2026-11-23
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M85PQQ2QDDQCZ9
release_note: "`hitld install` lists under `proposed` the worktree setup and checks it reads from the lockfile and the scripts the packages declare, pnpm and npm workspaces included (`pnpm install --frozen-lockfile`, `pnpm -r --if-present run test`); a change to `pnpm-workspace.yaml` now fires the new-dependency read."
---

## Done when

- On a scratch project that is a pnpm workspace (a `pnpm-workspace.yaml`, a `pnpm-lock.yaml`, two packages), `hitld install` proposes `pnpm install --frozen-lockfile` as the worktree setup and the checks the packages declare, and `hitld env setup` runs it in a fresh worktree.
- The new-dependency trigger fires when a branch changes `pnpm-lock.yaml` or a package's `package.json`, with the manifest and lockfile names read from the pnpm profile (HITLD-920, HITLD-921).
- `hitld release propose` and `release make` work for the workspace's packages, each with its own version in its `package.json` (HITLD-759).
- A test per case on a pnpm fixture, and the guide's worktree setup section shows the pnpm line.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner's cut-line decision HITLD-971: pnpm support must be in rc.2, because CesiumJS 2.0 is likely to move to pnpm. Install already detects `pnpm-lock.yaml` (`core/lib/env/setup-gap.mjs`) and the dependency trigger lists it (`core/lib/merge/owner.mjs`); nothing yet proves a pnpm workspace works end to end.

## Notes

Depends on HITLD-920 and HITLD-921 (kept in rc.2). The other build-system items (HITLD-922, 923, 924, 930) moved to rc.3 by the same decision.
