---
id: HITLD-954
title: The merge queue acts as its own GitHub App, opens pull requests as the App, and mints short-lived tokens per use
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-69 c2]
---

## Why

The queue today uses the session's own sign-in (`core/lib/merge/github.mjs`), locally the owner's. With one App per role the queue must act as `hitld-queue` and the owner must be able to tell its pull requests from their own.

## Done when

- The queue authenticates as the queue App, opens pull requests as the App, and mints a one-hour single-repository token per use that only its `gh` child process receives; branch commands never get it (HITLD-889).
- A test shows a branch-authored command cannot read the token.
- A merge-path change reaches main only with the owner's own yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable forge-enforcement spec (2026-11-22) and the owner's walk-through decisions HITLD-944 to 951. The permission an App needs to update a branch that changes workflow files is a guess: tested once, and if refused the queue App alone gets Workflows write.
