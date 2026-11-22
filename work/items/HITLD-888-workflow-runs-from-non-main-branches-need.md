---
id: HITLD-888
title: Workflow runs from non-main branches need approval, and the tag path is gated on the release environment and the release check
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

CI and the code-scanning workflow run on `pull_request` from same-repository branches, so the workflow file comes from the branch, and an executor pushing its claim branch can run a workflow it wrote, with a write token, before any owner approval. The `tagged` job in `.github/workflows/release.yml` gives any `v*` tag push `contents: write`, `id-token: write` and `attestations: write` with no environment, no release check and no check that the commit is on main; `CONTRIBUTING.md` recommends putting GitHub Actions on the tag ruleset's bypass list. A branch-authored workflow could create a tag and publish; consumers pinned to a tag by `--ref` run that commit's hooks.

## Done when

- A workflow run from a non-main ref needs approval, or CI runs from main's workflow definitions.
- The `tagged` job is gated on the `release` environment and the release check, and only for commits on main.
- `scripts/release-environment.mjs` verifies the tag ruleset, and the contributing guide no longer lists Actions as a bypass actor without that gate.
- A written proof, recorded in the item, that a branch-authored workflow cannot create a tag.
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S2 (high, likely: depends on the repository's settings, which the reviewer could not see) of the second Fable security pass (2026-11-22), decision HITLD-885. HITLD-867 covers forge protection in general but not Actions or the tag job. The repository settings themselves are the owner's to apply; the item lists exactly which.
