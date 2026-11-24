---
id: HITLD-1018
title: A literal dot folder after ** is found by the pnpm workspace read, and a throw in the setup proposal has a test
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `workspacePackages` finds a package under a literal dot folder that follows `**` in a pnpm workspace pattern (for example `**/.tools/*`), matching what pnpm finds on the same tree; a test on a scratch tree with `.tools/t` under a nested folder asserts it.
- A test makes the setup proposal throw (a pattern the reader rejects) and asserts `hitld install` still returns a result with the warning and no exception.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Pull request 595 (HITLD-976) was merged on the owner's yes on 2026-11-24 with these two non-blocking gaps found by the independent read: a literal dot segment after `**` under-reports packages, and the try/catch around `proposeSetup` has no test of the throw path. [Likely: the first under-reports, from the read of the dotSegments map; not run against pnpm.]

## Notes

rc.3. Small. Related: HITLD-976, HITLD-921.
