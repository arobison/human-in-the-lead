---
id: HITLD-713
title: Adversary record and file refuse any session that is not the orchestrator, not only one that says it is an executor
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

`hitld adversary record` and `hitld adversary file` refuse an executor by one test: the environment variable `HITLD_ROLE` equals `executor` (`refuseExecutor` in `core/lib/cli/commands/adversary.mjs`). The plugin's guard refuses the commands to executors first, but it is the second line that holds where the guard is not installed. An executor working in a linked worktree with a bare environment (no `HITLD_ROLE`) passes that test, and can write a regression test marked todo and commit it, or file a fix item. Recording breaks and filing fix items belong to the adversary and the orchestrator.

## Done when

- Both commands refuse a session that works in a worktree `hitld env` made for an executor dispatch, whatever its environment says, with the same refusal as for `HITLD_ROLE=executor`.
- The commands still work for the adversary agent and for the orchestrator on main.
- A test runs `adversary record` and `adversary file` from an executor's worktree with a bare environment and shows both refused, and from main and an adversary worktree and shows both allowed.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the pass on the core area (HITLD-32, PR 397). A rule an executor could break by accident is enforced by structure, not by a variable the executor sets (HITLD-537). Code: the owner's own yes to merge.
