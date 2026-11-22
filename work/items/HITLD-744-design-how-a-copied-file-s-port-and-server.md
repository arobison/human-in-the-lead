---
id: HITLD-744
title: Design how a copied file's port and server entries follow the worktree's leased port
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80ZP9FNCKPRJX
---

## Why

Reported as GitHub issue 417, second part. A file copied into a worktree (HITLD-743) can name the port or server the main checkout uses. Two worktrees then use the same port, or an executor talks to another checkout's server, while hitld leases each worktree its own port. Rewriting those entries is a design question, not a copy: which keys are rewritten, in which file formats, and how a rewrite is told from a value the project meant. The owner kept it out of rc.2 (HITLD-736).

## Decided on 2026-11-22 (owner)

The project supplies a template for a copied file (for example `launch.json.template` with `${HITLD_PORT}`), `.worktreeinclude` marks it as a template, and `hitld env setup` renders it with the worktree's leased port and drops entries the project marks `owner-only`. HITLD knows no file formats; plain copies stay for files with no ports.

## Done when

- `.worktreeinclude` can mark a file as a template; `hitld env setup` renders it into the worktree with the leased port and omits entries marked `owner-only`, and never prints the rendered contents.
- A rendered file that the worktree would not ignore is deleted, as for plain copies (HITLD-743).
- `hitld env check` reports a template that failed to render.
- Tests cover a template with the port, an owner-only entry, and a missing placeholder value. `npm run check`, the offline eval gate and `hitld work check` pass.
