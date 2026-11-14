---
id: HITLD-50
title: "hitld env primary --reset: the owner moves the recorded primary checkout"
kind: work
status: Planned
created: 2026-11-14
project: HITLD-15
---

## Why

The primary checkout's path is recorded once (design 13.2) and the first record wins, so moving the checkout locks out `hitld env exec`. The owner needs a way to move it.

## Done when

- `hitld env primary --reset` clears the record from the main session in the new primary checkout; it is refused for executors (dispatch variables or a linked worktree) and over MCP.
- The reset is a ledger event; the next run start records the new path.
- Tests cover the reset, the refusals and the record afterwards.


