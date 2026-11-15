---
id: HITLD-58
title: Symlink-safe worktree teardown
kind: work
state: done
created: 2026-11-14
project: HITLD-15
claimed_by: D-58
---

## Why

Design 13.2, "Cleanup". A worktree's dependency directory can be a link into another checkout, a shared cache, or something outside the worktree. Deleting the worktree must never follow that link and delete what it points at.

## Done when

- Cleanup never follows a link. It unlinks the link and does not touch its target.
- Before deleting anything, the real path is resolved and checked to be inside the worktree. A path that resolves outside is unlinked, not removed.
- Windows junctions count as links.
- A setup command that creates a link pointing outside the worktree is flagged when setup runs.
- A test builds a worktree whose dependency directory is a link into another checkout, runs cleanup, and finds the other checkout intact.
