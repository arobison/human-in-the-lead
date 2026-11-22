---
id: HITLD-909
title: "Small release and runtime correctness items: partial tag failure cleanup, dependents in_range, the last-megabyte result read"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

Small points from the independent read: a partial failure on main (commit made, second tag fails) leaves one tag and staged files with no cleanup, where the `--branch` path cleans up; `dependentsFor` reports `in_range: true` for every transitive dependent; the durable-executor result reader looks at the last 1 MB, so a longer final line classes a finished run as gone.

## Done when

- Each of the three has a test and a fix, or a written reason it stays.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable independent read of the delegated merges (2026-11-22), finding R15; decision HITLD-897. rc.3 by the owner's decision.
