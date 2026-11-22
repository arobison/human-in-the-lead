---
id: HITLD-711
title: The adversary's shrinking builds its smaller candidates one at a time, not all at once
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-68 c4]
---

## Why

The adversarial pass shrinks each break to its smallest counterexample (`shrink` in `core/lib/adversary/generate.mjs`). `smaller` builds the whole list of smaller candidates for a value before the first one is tried, and `shrink` takes only the first candidate that still fails and then starts again. For a long string that is one new string for every position, and for an array of strings it is that for every member, all built and most thrown away. The cost grows with the input and is paid again on each step, so a break found on a large input is slow to reduce, and the pass's time limit can cut it off.

## Done when

- `smaller` yields its candidates one at a time, simplest first, so a candidate is built only when `shrink` asks for it.
- The smallest counterexamples for the invariants of the core area are the same as before the change (a test compares them).
- A test counts the candidates built for a long string whose first candidate still fails, and shows one built, not all.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the pass on the core area (HITLD-32, PR 397). Code: the owner's own yes to merge. Related: HITLD-712.
