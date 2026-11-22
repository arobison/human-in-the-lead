---
id: HITLD-744
title: Design how a copied file's port and server entries follow the worktree's leased port
kind: work
state: done
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80ZP9FNCKPRJX
release_note: "`.worktreeinclude` can mark a template with a `#hitld:template <path>.template` comment line: `hitld env setup` leases the worktree's port and renders the template into `<path>` with `${HITLD_PORT}` filled and the lines marked `hitld:owner-only` left out, under the copy rules, and `hitld env check` reports a template that does not render, by path and reason only."
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

## Notes

The syntax the executor settled (D-01M80ZP9FNCKPRJX), for the curator to carry into design part 13:

- A comment line `#hitld:template <path>.template` in `.worktreeinclude` marks a template in the primary checkout, tracked or git-ignored. It renders to `<path>`. Git and Claude Code read the line as a comment. `<path>` is never also copied as a plain file.
- `${HITLD_PORT}` is the worktree's leased port; setup leases it when a template is marked. Any other `${HITLD_<NAME>}` has no value and fails the render. Other `${...}` text is kept.
- A line holding `hitld:owner-only` is left out, and so is a block from a line holding `hitld:owner-only-begin` to one holding `hitld:owner-only-end`, marker lines included.
- A template that does not render fails neither setup nor the worktree. Setup records it under `setup.templates.failed`, and `hitld env check` reports it under the existing code `include-missing`, with the template's path and a reason (`missing-value`, `template-missing`, `bad-template-path`, an unbalanced owner-only block).
