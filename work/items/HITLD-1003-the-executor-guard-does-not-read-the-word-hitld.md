---
id: HITLD-1003
title: The executor guard does not read the word hitld inside a branch name as a command
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The executor guard (hitldCalls) treats `hitld/<name>` in a branch name, a path or a ref argument as plain text, not as a `hitld` command; a test covers `git push origin hitld/HITLD-1-x`, `git checkout hitld/x` and `git log hitld/x`.
- A real `hitld` command, including after `&&`, `;` and in a subshell, is still checked as before; a test asserts it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The branch names the dispatch tool prints start with `hitld/`, and the guard's pattern `\bhitld\b` reads that prefix as a command, so an executor's ordinary git command on its own branch can be refused. Found by the chief of staff on 2026-11-24 while an executor was stopped on its own branch name.

## Notes

rc.3. Not a ship blocker: executors work around it. Review doubt to check while here: other words the pattern may catch (a directory named hitld, a file path under .human-in-the-lead).
