---
id: HITLD-889
title: The merge queue runs a branch's commands with an isolated environment and an explicit allowlist
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

The merge queue passes its whole environment minus one variable to the project's test and scanner commands (`core/lib/merge/queue.mjs` `shellExec`). A test added on a branch can read the store key (in a cloud session) or forge tokens, and the queue runs it before the owner sees the pull request; with HITLD-887 that key opens the whole store.

## Done when

- Queue commands run under an isolated environment plus an explicit allowlist of variables, with no store identity, no forge token and no HITLD session variables.
- A test shows a branch-authored test cannot read them.
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S3 (medium) of the second Fable security pass (2026-11-22), decision HITLD-885. 
