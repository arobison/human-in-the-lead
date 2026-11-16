---
id: HITLD-300
title: "Main carries 3 CodeQL alerts (shell command from an environment path) from the Windows pull request: fix them or dismiss them with the owner's reason"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Found by D-20 (HITLD-62) with a local run of the pinned CodeQL 2.27.4 and CI's suite; not yet checked in the code scanning UI. Three results (D-22 read a security severity of 6.3 in the SARIF, which GitHub ranks medium; high starts at 7.0, so they likely do not fail a PR's high-alert gate), `js/shell-command-injection-from-environment` ("This shell command depends on an uncontrolled absolute path"): `core/lib/env/worktree.mjs:129` (the spawn of the owner-declared `env.worktree_setup` command), its plugin copy at the same line, and `core/test/env.test.mjs:1159`.

They arrived with the Windows pull request (PR #186, merged at `7fc07c3`). CodeQL's result check was green on that pull request's head, so it did not fail them. The code's own comment says the command is declared by the owner on purpose, so a dismissal with that reason is a real option.

## Done when

- The owner decides: fix the code so the alerts clear, or dismiss them in the code scanning UI with the owner's reason written in the code comment.
- Either way, `main` carries no open high alert that nobody has decided, and `npm run check` and `hitld work check` pass.

