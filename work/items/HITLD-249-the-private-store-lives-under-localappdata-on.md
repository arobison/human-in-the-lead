---
id: HITLD-249
title: The private store lives under %LOCALAPPDATA% on Windows, with XDG_DATA_HOME still overriding and a one-time move of an existing store
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-243, HITLD-153]
release_note: "On Windows the private stores and the machine file live under `%LOCALAPPDATA%\\human-in-the-lead` (`XDG_DATA_HOME`, when set, still overrides it on every platform). The first time `hitld` resolves a store or the machine file still at the old `~/.local/share/human-in-the-lead`, it moves it there and says so, unless it is in use (executor worktrees, a live run lease, a live resource lock); then it stays and is used where it is until a later run. Upgrade every project on the machine at once with no sessions running: a session on an older release keeps using the old place."
---

## Why

Ordering (the owner, in the chief of staff session): this waits for HITLD-153, so the planner builds the fix for a finished-but-unmerged item holding a slot first. It is an ordering choice, not a technical dependency.

The owner decided (HITLD-245) that the store moves from `~/.local/share/human-in-the-lead/<id>` to `%LOCALAPPDATA%\human-in-the-lead\<id>` on Windows, before outside users rely on the old path. PR #186 (Windows) left it alone as a decision.

## Done when

- On Windows the default store directory is `%LOCALAPPDATA%\human-in-the-lead\<id>`; `XDG_DATA_HOME`, when set, still overrides it on every platform.
- A store found at the old Windows location is moved once, with a message and without losing a file; a second run does nothing.
- The install guide and the design (part 16, the store path) say the Windows location.
- A test covers the default, the override and the one-time move (on Windows only where a path test needs it).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the owner's decisions on the open questions in the Windows pull request (PR #186, HITLD-243). Needs HITLD-243: the pull request changes the same code.
