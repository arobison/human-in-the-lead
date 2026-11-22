---
id: HITLD-829
title: The store sync tests pass whatever session variables the harness sets
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-191 c2]
---


## Why

A store-sync round-trip test fails when the harness's session ID variables are set, on main as well as on a branch. The HITLD-763 executor ran `npm run check` with them unset to get a green result and said so in its report.

## Done when

- `core/test/store-sync.test.mjs` sets or clears the session variables itself, so `npm run check` passes with any harness environment.
- `npm run check` passes with and without the variables set.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
