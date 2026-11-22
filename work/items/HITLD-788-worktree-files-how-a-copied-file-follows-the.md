---
id: HITLD-788
title: "Worktree files: how a copied file follows the leased port"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Project templates with placeholders: The project supplies a template with ${HITLD_PORT}; .worktreeinclude marks it as a template; hitld env setup renders it with the leased port and drops entries marked owner-only."
answered_at: 2026-11-22T03:55:42.754Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-744: how do a copied file's port and server entries follow the worktree's leased port?

A copied launch config names the main checkout's port and entries that attach to the owner's servers.

## Options and recommendation

- A. Project templates with placeholders: The project supplies a template with ${HITLD_PORT}; .worktreeinclude marks it as a template; hitld env setup renders it with the leased port and drops entries marked owner-only.
- B. Rewrite rules declared next to the file: A JSON path or pattern per file.
- C. No rewriting; an environment variable: Setup exports HITLD_PORT.

Recommended: Project templates with placeholders. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
