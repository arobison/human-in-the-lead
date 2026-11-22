---
id: HITLD-705
title: The synchronous mutex breaks a dead holder's lock under a second lock, so two takers cannot both win
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c1]
---

## Why

HITLD-241 made `withMutexSync` retry when its lock directory is moved aside between creation and the owner write, and its Notes left one hole open. Breaking a dead holder's lock goes by path, and a rename cannot be made conditional on which directory the path names. Two takers breaking the same dead holder's lock within a few microseconds (one between its identity check and its rename while the other removes the dead directory and a third process makes a fresh one) can still leave two holders. The registry, the lease and the merge queue rely on this mutex, so two holders corrupt shared files without any error.

## Done when

- A test reproduces the hole first (design 14.7), for example by pausing one taker between its identity check and its rename, and shows two holders on the current code.
- The break itself is serialized, by a breaker mutex beside the mutex or by an operating-system file lock; the build says which and why, and core takes no third-party runtime dependency.
- The same test shows one holder at a time with the fix, for `withMutexSync` and for `withMutex`.
- The machine registry test runs 20 times in a row with the CI-like settings without a failure.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Follows HITLD-241 (done, PR 412), whose Notes say this wants an item of its own. Not a reason to skip or quarantine a test. Code: the owner's own yes to merge.
