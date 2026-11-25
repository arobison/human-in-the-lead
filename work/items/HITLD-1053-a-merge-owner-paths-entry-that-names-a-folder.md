---
id: HITLD-1053
title: A merge.owner_paths entry that names a folder covers everything under it, and the policy check flags one that matches nothing
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when

- `merge.owner_paths` entries `core/` and `core` (a folder with no glob) cover every file under that folder in `underOwnerPaths` (`core/lib/merge/owner.mjs`), the same as `core/**`; a test fails on current main and passes after: a branch that changes only `core/lib/x.mjs` waits for the owner under each of the three spellings, and a `!` entry still takes files back out.
- `hitld check policy` names every `owner_paths` entry that matches no file in the repository and says what to write instead, so a mistyped path cannot leave a guard silently open.
- The skills and docs that tell a project how to write `owner_paths` show the folder form.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 671: a bare folder entry matched no files, so a branch that changed only files in that folder merged in owner mode without the owner seeing it, and nothing warned. Confirmed on main: `underOwnerPaths('core/lib/x.mjs', ['core/'])` is false for `core/`, `core` and `work/*`, and true only for `core/**`.

## Notes

A silent fail-open on the owner's own guard. Owner-held (merge path and policy): the owner's own yes at review. In rc.2 on the owner's answer of 2026-11-25. Ordinary code otherwise, reviewed independently before merge.
