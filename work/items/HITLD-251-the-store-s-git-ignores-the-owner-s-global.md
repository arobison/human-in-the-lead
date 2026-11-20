---
id: HITLD-251
title: The store's git ignores the owner's global ignore and attributes files, on every platform
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-243, HITLD-153]
---

## Why

Ordering (the owner, in the chief of staff session): this waits for HITLD-153, so the planner builds the fix for a finished-but-unmerged item holding a slot first. It is an ordering choice, not a technical dependency.

The store's `git add -A` still reads the owner's global ignore and attributes files, because `GIT_CONFIG_GLOBAL` does not cover them. A global ignore of `*.json` would silently leave store files out. The owner decided (HITLD-247) to fix it on every platform with `-c core.excludesFile=` set to an empty file and the same for attributes.

## Done when

- Every git call the store makes that stages or reads attributes ignores the owner's global ignore and attributes files.
- A test sets a global ignore of `*.json` and a global attributes rule, and checks that a store write still stages and commits every file it wrote, with the same result on macOS, Linux and Windows.
- The behavior change on macOS and Linux is named in the release note.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the owner's decisions on the open questions in the Windows pull request (PR #186, HITLD-243). Needs HITLD-243: the pull request changes the same code.
