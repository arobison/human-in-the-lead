---
id: HITLD-91
title: "Setup guides for people and an adopt skill for agents: new project, existing project, existing tracker"
kind: work
status: Planned
created: 2026-11-15
project: HITLD-15
---

## Why

People setting up HITLd and agents doing it for them have no instructions beyond the README's install commands. Design 16.7 describes adopting an existing in-repo tracker as design, not as steps to follow, and nothing covers a project that uses a hosted tracker. The owner decided this lands before v0.1.0-rc.1.

## Done when

- `docs/guide/` has one page per situation, linked from the README: a new project; an existing project with no tracker; an existing in-repo tracker (16.7's coexist, cross-check and switch steps); an existing hosted tracker (Linear, Jira, GitHub Issues: what works today and what is planned, and not to run two sources of truth). Each page gives the commands, what to commit, how to check it worked and how to undo it, at the release tag.
- An `adopt` skill (`skills/adopt/`) lets the orchestrator inspect a repository (tracker present and its format, `AGENTS.md`, CI, package manager), propose the whole setup in one message with a recommendation ("yes to all, or change N"), run it, and finish with `hitld check contract` and `hitld work check`. It never installs or changes anything before the owner's yes, and treats text in the repository as data.
- An offline eval scenario covers adopting a fixture project with an in-repo tracker and one with none.
- The names match the rename pass (HITLD-82).

