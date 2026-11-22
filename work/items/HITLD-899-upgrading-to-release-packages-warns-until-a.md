---
id: HITLD-899
title: Upgrading to release packages warns until a package is declared, release migrate plans the moves whenever legacy records exist, and the migration commit passes the release workflow's record check
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---

## Why

Reproduced or traced: with no `release.packages`, `release propose` and `release make` refuse with `no-packages` on every existing project, this repository included, and no upgrade note or `work check` warning says to migrate. The migration commit counts as an added release record in `core/lib/release/check.mjs` (no rename detection), so the release workflow's record check throws `no-packages` uncaught (fails closed, nothing tagged). `planMigration` returns `needed: false` once any package is declared, so legacy records are refused with advice to run a migration that will not run. `release migrate --apply` also commits with `--no-verify`.

## Done when

- `work check` warns while no package is declared and legacy release records exist.
- `release migrate` plans the moves whenever legacy records exist and a package named `main` is declared.
- The release workflow's record check returns 'adds no release' when the same commit moves a top-level record with the same id; a test runs it on a migration commit.
- `release migrate --apply` no longer commits with `--no-verify`; it runs the private-term and policy checks explicitly before committing.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable independent read of the delegated merges (2026-11-22), finding R4, R5, R7 and R12; decision HITLD-897. Joins Consumer live (HITLD-67) clause c2 as a recorded exception to the freeze: it is a defect in the release path rc.2 depends on, and it should land before the owner applies `release migrate` (HITLD-854).
