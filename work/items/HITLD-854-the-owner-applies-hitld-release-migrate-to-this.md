---
id: HITLD-854
title: The owner applies `hitld release migrate` to this repository so release propose finds its packages
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-759]
constraint_of: [HITLD-67 c2]
---


## Why

The HITLD-759 build (pull request 527) leaves this repository unmigrated: until `hitld release migrate` is applied, `release propose` returns no-packages, and the rc.2 release item HITLD-137 depends on the migration. The migration keeps `v0.1.0-rc.1` resolvable and commits `release/surface.txt`; it is one-way (the owner's step), so it is the owner's own.

## Done when

- `hitld release migrate --dry-run` is read by the owner, then applied through a pull request the chief of staff opens, which the owner approves.
- `hitld release propose` on main then reports this repository's main package with its tag template v{version} and no `no-packages` error; `v0.1.0-rc.1` still resolves.
- A release change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.
