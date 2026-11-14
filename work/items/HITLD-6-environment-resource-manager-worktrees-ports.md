---
id: HITLD-6
title: "Environment resource manager: worktrees, ports, locks, secret tasks (piece c)"
kind: work
status: Done
created: 2026-11-14
project: HITLD-2
---

## Why

Part of the slice usable in a consuming project.

## Done when

- A worktree is created per executor from the tip of `main`, set up by the declared commands, and removed after a merge or an abandonment.
- Dev-server ports are leased and never touch a server the manager did not start.
- Serial resources are locks with holders, stale holders expire, and waits are recorded.
- A secret reaches a child process only through a declared task and never appears in output.
- The three environment scenarios (ports, locks, secrets) pass offline.
