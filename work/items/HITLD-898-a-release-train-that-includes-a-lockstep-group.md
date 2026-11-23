---
id: HITLD-898
title: A release train that includes a lockstep group works, a release an open train needs is not made alone, and a version label is checked against the package's channels
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M82XAVA0EAWQ2Q
release_note: "A release train may include a lockstep group, whose members share one release item; while a train is open, `hitld release make` refuses a release it needs (`release-in-train`), naming the train, and the release workflow's record check does the same; a `--version` or `--pre` label that is not one of the package's channels is refused (`not-a-channel`)."
---

## Why

Reproduced by running the code: `release propose --train` for a train that includes a lockstep group returns `release-item-mismatch`, because every group member shares one release item and `releasesOf` rejects it for each sibling (`core/lib/release/propose.mjs`); leaving `package` off the item fails with `package-required`. `release make --package core` succeeds and tags while an open train needs that release, against design 03 (a release a train needs is not made alone). `release make --version 0.1.0-zeta.7` succeeds for a package whose channels are `[rc]`.

## Done when

- `releasesOf` accepts a release item whose package is in the same lockstep group, and a test combines a train with a group.
- `release make` refuses a release that an open train needs, and names the train.
- `makeRelease` validates a `--version` label against the package's channels.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable independent read of the delegated merges (2026-11-22), finding R1, R2 and R11; decision HITLD-897. Joins Consumer live (HITLD-67) clause c2 as a recorded exception to the freeze: it is a defect in the release path rc.2 depends on, and it should land before the owner applies `release migrate` (HITLD-854).
