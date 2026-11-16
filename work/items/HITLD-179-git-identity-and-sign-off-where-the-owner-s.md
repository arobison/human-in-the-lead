---
id: HITLD-179
title: "Git identity and sign-off: where the owner's sign-off lives, what identity agents commit with, and what self-hosting changes"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Two kinds of commits need an identity, and nothing says where it comes from. The person file has no git identity key, so each container uses whatever git config it happens to have, and a cloud container has none. In the first self-hosted run a GitHub runner with no identity broke the merge queue's own `git merge` in a test (HITLD-133), and agent sessions have passed an identity on each command by hand. The DCO check accepts a pull request's agent commits (an `Agent-Role` or `Dispatch` trailer) without a sign-off, and requires a person's `Signed-off-by` on every commit pushed to main, so the approver signs the squash commit. `release make` signs with whichever git identity runs it. The owner has delegated merging tracker-only pull requests without asking, with their sign-off marked as delegated (HITLD-158, HITLD-159, HITLD-150). When HITLd runs its own development, the tool, the project and the maintainer are one, and some design rules that assume they differ need a stated special case. This item records the choices and brings them to the owner.

## Done when

- The owner decides, in a design walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built:
  - Where the owner's sign-off identity (a name and an email) lives: the person file, synced through the store (HITLD-162), the project's `policy.json`, or git's own config in each container. A public file may hold only the owner's public GitHub noreply address, never a personal one.
  - Which address it is, and how the personal address stays out of public history (the private term list and the commit guard).
  - What identity agent commits use: one fixed agent identity shipped with the plugin, so no container needs git config, or a per-machine setting.
  - What the merge queue, `release make`, `hitld work publish` and the claim and close commands use for author and sign-off.
  - What self-hosting changes, from the Opus analysis the owner asked for (to be added here): which design rules need a stated special case.
- The design (the DCO section, part 14, the person file in part 13 and the packaging part) says the chosen answer in one change the owner approves, and the schema, the plugin and the checks follow in build items.
- A test shows a container with no git config still commits and merges as the chosen agent identity, and that a sign-off made under the standing rule carries the delegated marker.

## Notes

Raised by the owner in the chief of staff session, who asked to file it as a design change proposal. The first recommendation to the owner was: the owner's sign-off pair in the person file, with the GitHub noreply address, and a fixed agent identity from the plugin. It is a recommendation, not a decision. It changes the person file schema and the plugin, so it needs the owner's walk-through first. Related: HITLD-148 (person settings in the store), HITLD-150, HITLD-133 (the merge queue).

