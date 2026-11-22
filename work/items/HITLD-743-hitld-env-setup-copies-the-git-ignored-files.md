---
id: HITLD-743
title: hitld env setup copies the git-ignored files that .worktreeinclude lists into a worktree, and env check reports a missing one
kind: work
state: done
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80K7ZVA06CP5T
release_note: `hitld env setup` copies the git-ignored files `.worktreeinclude` lists into the worktree, under Claude Code's rules (matched and git-ignored, never tracked, never outside the repository, never over an existing file), and the new `hitld env check` names a listed file a worktree lacks, by path only.
---

## Why

Reported as GitHub issue 417. A project lists the git-ignored files that a worktree needs (a local environment file, a local settings file) in `.worktreeinclude`, and Claude Code copies them into the worktrees it makes. `hitld env setup` makes its own worktrees and does not copy them, so an executor starts without the files its tests or server need, and `hitld env check` does not say that one is missing.

## Done when

- `hitld env setup` copies into the new worktree each file that `.worktreeinclude` lists, under the rules Claude Code uses: only files that match a pattern in the list and are also git-ignored, never a tracked file, never a path outside the repository.
- `hitld env check` reports a listed file that is missing from the worktree, naming the path and not printing its contents.
- No copied file's contents are ever printed, logged or committed: not in the command's output, the ledger or a commit, and a copied file stays git-ignored in the worktree.
- A test covers a copied file, a tracked file that is skipped, a path that escapes the repository, and the check reporting a missing file. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Rewriting a copied file's port or server entries to the worktree's leased port is a separate design item (HITLD-744). Related: HITLD-130 (worktree and disk handling). Code: the owner's own yes to merge.
