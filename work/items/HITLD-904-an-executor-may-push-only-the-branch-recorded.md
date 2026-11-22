---
id: HITLD-904
title: An executor may push only the branch recorded for its dispatch
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

The push guard allows any `hitld/` branch that holds a claim commit, so an executor can create and push a new `hitld/*` name without force: 'its own branch' is not the branch recorded for its dispatch. The relaxation came in with the durability PR (PR 516) and was tightened by PR 537, but this part is open.

## Done when

- The guard compares the pushed branch with the branch recorded in the claim commit or the dispatch brief, and refuses any other.
- A test pushes a new `hitld/*` branch and shows it refused. A guard change reaches main only with the owner's own yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable independent read of the delegated merges (2026-11-22), finding R10; decision HITLD-897. rc.3 by the owner's decision; HITLD-868 (executor identity) is the sibling.
