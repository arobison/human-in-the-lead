---
id: HITLD-1060
title: hitld install detects common hook managers and adds its guard lines to the hook files the manager owns, or says plainly that its hooks will be overwritten
kind: work
state: proposed
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `hitld install` detects husky, lefthook and a copy-a-hooks-folder install script, and adds the guard lines to the hook files that manager owns so they survive its next run; a test covers each detected manager.
- Where it cannot, the install output says in plain words that the manager overwrites hitld's hooks and what to do.
- `hitld check` warns when the guard hooks are missing after a manager's run (see HITLD-265).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 666: in a repository whose hooks a tool manages, hitld install only warned that hooks existed; the manager's next run overwrote the guard hooks without any notice.

## Notes

rc.3, proposed. Related: HITLD-265 (warn when the commit guard isn't running in a worktree). Hooks are a guard path: owner-held.
