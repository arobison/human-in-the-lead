---
id: HITLD-1055
title: Before the first dispatch, a rehearsal cuts a fresh worktree from the main branch, runs the configured setup and the fast checks, and reports what fails
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- A command (for example `hitld env rehearse`) creates a fresh worktree from `merge.main_branch`, runs `env.worktree_setup` and the fast checks in it, removes it, and reports each failure with the command and its output; run before the first dispatch, and offered by the setup skill.
- A test: a setup that works only in the primary checkout (a tool installed by hand, or a commit-email rule other worktrees reject) fails the rehearsal with the cause named.
- `hitld check policy` still only validates the settings; the rehearsal is the check that runs them.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 663: the policy check confirmed the settings were well formed but never ran them, so setup passed every check and then failed in the first executor worktree and the first merge-queue worktree, and fixing it took more than one round of questions to the person.

## Notes

rc.3. Sits beside HITLD-292 (the empty-worktree check) and HITLD-976. Ordinary code.
