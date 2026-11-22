---
id: HITLD-820
title: The store pull does not stop on a gitlink in the local head, and names the path it found
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---


## Why

On 2026-11-22 the chief of staff's `hitld store pull` stopped on five worktree gitlinks (mode 160000) that an export from another container had committed, and the orchestrator's pull failed with git-failed: no blob 293f000d... because its own head held two live-worktree gitlinks that the pre-import export put back. Both needed hand repair in the store's git (`git rm --cached`, a manual merge, a union of the trust events log). HITLD-763 stops new gitlinks, but any store that already holds one stays stuck.

## Done when

- `hitld store pull` and `store sync` drop a gitlink from the local head before merging (the directory stays on disk) and import an incoming head that carries one, naming each path in a warning; the pull no longer fails with `no blob` or `mode 160000 is not a plain file`.
- A test builds a store whose head holds a gitlink and one whose incoming head does, and pulls both; it also covers the same append-only log changed on both sides.
- A store change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
