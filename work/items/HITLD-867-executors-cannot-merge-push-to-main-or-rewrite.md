---
id: HITLD-867
title: Executors cannot merge, push to main or rewrite shared state at the forge, whatever their hooks do
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

The Fable trust-boundary review (2026-11-22) found that no guard here binds an executor that is trying to get around it: hooks read text, and a cloud executor holds credentials and tools the guard never sees. Only the forge can say no to a push or merge that no hook can be made to refuse.

## Done when

- The project's main branch is protected at the forge: no direct pushes, required checks, no admin bypass for agent credentials, and pull requests merge only through the merge queue's identity.
- Executor credentials can push only the executor's own `hitld/<item>` branch (a branch-scoped token or ruleset), and cannot merge a pull request, push tags or change repository settings.
- `hitld check` (or `hitld doctor`) reports whether these protections are in place, reading them from the forge, and says what the owner must set when they are not. The settings themselves are the owner's to apply; the item records exactly which.
- A fresh-session proof for the release: an executor-credential push to main and a forge-side merge are refused by the forge, recorded in the item.
- A guard, policy or rights change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Findings T2, T3 and T4 of the review, and decision HITLD-866. Build this before the hook fixes: HITLD-856 and HITLD-857 follow it and become polish. Owner-side steps (the forge settings) are listed in the item when built.
