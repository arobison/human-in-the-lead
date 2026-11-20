---
id: HITLD-50
title: "hitld env primary --reset: the owner moves the recorded primary checkout"
kind: work
state: planned
created: 2026-11-14
project: HITLD-15
---

## Why

The primary checkout's path is recorded once (design 13.2) and the first record wins, so moving the checkout locks out `hitld env exec`. The owner needs a way to move it.

## Done when

- `hitld env primary --reset` clears the record from the main session in the new primary checkout; it is refused for executors (dispatch variables or a linked worktree) and over MCP.
- The reset is a ledger event; the next run start records the new path.
- Tests cover the reset, the refusals and the record afterwards.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (492/470): reset is ledger event, next run start records path; run start removed. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); the ledger and no-run decisions (HITLD-484 to 490). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
