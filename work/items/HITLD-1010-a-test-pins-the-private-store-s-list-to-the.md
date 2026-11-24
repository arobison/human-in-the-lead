---
id: HITLD-1010
title: A test pins the private store's list to the folder its prefix names and tolerates a folder that vanishes
kind: work
state: in-progress
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
claimed_by: D-01M860KPVMA8M3EF
---

## Done when

- A test builds a store with a large `worktrees/` folder and a `feedback/` folder, and asserts that `list('feedback/')` and the next feedback record ID read none of the worktree files (count the directory reads, or make the worktree folder unreadable).
- A test removes a folder in the walked prefix while `list` runs and asserts the walk skips it and does not throw.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 603 (v0.1.0-rc.1) reports that recording one piece of feedback took 3 to 5 minutes, because `list(prefix)` read the whole store root, 27 worktrees and 46 GB, and failed with ENOENT when a worktree was removed mid-walk. On main the cause is fixed: since HITLD-74 (pull request 393, after rc.1) `list` walks only the folder the prefix names. [Certain: rc.1's `core/lib/store/store.mjs` reads `base` recursively; main reads the prefix folder.] No test pins that, so a later change could bring it back.

## Notes

rc.2. The issue stays open until rc.2 ships; reply on it that main no longer walks the root and ask the reporter to retest. Related: HITLD-600 (read commands do not walk the store), HITLD-879 (precedent match skips a vanishing folder). A prefix with no slash still walks the root; check the callers while here.
