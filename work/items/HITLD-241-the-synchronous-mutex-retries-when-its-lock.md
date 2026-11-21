---
id: HITLD-241
title: The synchronous mutex retries when its lock directory is moved aside between creation and the owner write
kind: work
state: done
created: 2026-11-16
project: HITLD-15
claimed_by: D-59
---

## Why

On GitHub, the `tests` job of PR #180 failed once with `core/test/machine-registry.test.mjs:98` ("many processes registering at once never pass the cap or corrupt the file"): `ENOENT: no such file or directory, open '.../machine-2/.registry.mutex/owner'` at `core/lib/env/mutex.mjs:91`, called from `withMutexSync` through `updateMachineRegistry`. The pull request touches neither file. This is the second flake of that kind (HITLD-19 fixed an earlier one).

Likely cause, from reading the code and not yet reproduced: `withMutexSync` does `mkdirSync(dir)` and then `writeFileSync(join(dir, 'owner'))`. A second process that finds the directory held by a dead owner renames `dir` aside by path; if a third process has made a fresh `dir` in the meantime, the rename takes the fresh directory, and the third process's write fails with `ENOENT` because the directory has gone. The aside check then moves the directory back, so the window is small and shows up only under load. The same shape may exist in the async `withMutex`.

## Done when

- A test reproduces the race deterministically first (design part 14.7), for example by pausing a process between the `mkdirSync` and the write.
- `withMutexSync` (and `withMutex` if it has the same shape) treats an `ENOENT` on the owner write as lost-the-race and takes the loop again, as it does for `EEXIST`; a rename aside checks the directory's identity so it cannot take a fresh one.
- The registry test runs 20 times in a row, with the CI-like settings, without a failure.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the chief of staff reading the failed job's log, and filed under HITLD-181. Not a reason to skip or quarantine the test.

Follow-up, not built here: the takeover still goes by path, and a rename cannot be made conditional on which directory the path names. Two takers breaking one truly dead holder's mutex within the same few microseconds (one between its identity check and its rename while the other removes the dead directory and a third process makes a fresh one) can still leave two holders. Closing that needs the break itself serialized: a breaker mutex beside the mutex, or an operating-system file lock. That wants an item of its own.
