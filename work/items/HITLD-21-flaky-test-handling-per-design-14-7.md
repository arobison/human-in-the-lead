---
id: HITLD-21
title: Flaky-test handling per design 14.7
kind: work
status: Planned
created: 2026-11-14
project: HITLD-15
needs: [HITLD-20, HITLD-19]
---

## Why

Rerun on the same commit, base-versus-candidate comparison, burn-in of new tests, quarantine file with expiry and guard, digest reporting, flake measures.

The merge queue now holds a batch whose full suite fails and then passes on a rerun of the same commit (`merge.flake_reruns`): nothing merges, nothing is blamed, the rerun is recorded as a flake candidate, and the owner decides. This item replaces that hold with 14.7's rule: the base comparison decides, burn-in runs on new tests, the quarantine file (test IDs, environment scope, expiry, fix item only; evidence stays in the private store) is guarded, and part 21 says what is built.

## Done when

- A failing full suite is rerun on the same commit, and the base-versus-candidate comparison decides whether the batch is blamed.
- New tests are burned in before they join the suite.
- The quarantine file holds test IDs, environment scope, expiry and a fix item only. The guard refuses an entry without an expiry or a fix item, and evidence stays in the private store.
- The digest reports quarantined tests and the flake measures.
- Part 21 says what is built, and the `merge.flake_reruns` hold is gone.
