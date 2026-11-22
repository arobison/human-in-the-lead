---
id: HITLD-744
title: Design how a copied file's port and server entries follow the worktree's leased port
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
---

## Why

Reported as GitHub issue 417, second part. A file copied into a worktree (HITLD-743) can name the port or server the main checkout uses. Two worktrees then use the same port, or an executor talks to another checkout's server, while hitld leases each worktree its own port. Rewriting those entries is a design question, not a copy: which keys are rewritten, in which file formats, and how a rewrite is told from a value the project meant. The owner kept it out of rc.2 (HITLD-736).

## Done when

- A written design says which entries of a copied file are rewritten to the worktree's leased port, how a project declares them (a pattern or a key list, not a guess from the content), the file formats covered, and what happens to an entry that cannot be rewritten safely.
- The design says how a rewritten file stays out of commits and logs, as HITLD-743 requires of a copied file.
- The owner's decision on the design is recorded before any build item is filed. `hitld work check` passes.

## Notes

Proposed, not in a milestone. Depends on HITLD-743 for the copy itself.
