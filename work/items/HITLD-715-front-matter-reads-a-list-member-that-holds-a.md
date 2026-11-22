---
id: HITLD-715
title: Front matter reads a list member that holds a double quote in the middle of it
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-68 c4]
---

## Why

The front-matter reader splits an inline list on commas that are outside double quotes (`splitList` in `core/lib/tracker/files/frontmatter.mjs`), and it flips its quoting on any double quote, even in the middle of a member. So `needs: [a"b, c]` reads back as one member, `a"b, c`, though it holds two. `renderItem` writes a member that holds more double quotes than single quotes in single quotes, and the reader flips its quoting on the double quote inside them, so a list written by `renderItem` does not read back the same with `parseItem`. The adversarial pass on the core area found it (invariant `front-matter-round-trip`); its three counterexamples are a list of the members `"` and `a`, a list of the one member `"",` and a list of the one member `,"`.

## Done when

- A double quote opens a quoted member only at the start of the member, after any spaces, and single-quoted members are read as the single-quoted scalars they are, so `needs: [a"b, c]` reads as the members `a"b` and `c`.
- A list `renderItem` writes reads back as the same members with `parseItem`, including members that hold `"`, `'`, a comma or a closing bracket.
- The three regression tests under `core/test/adversary/` for `front-matter-round-trip` pass and lose their todo marks.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the adversarial pass (HITLD-32, PR 397). One cause: the reader's quoting; the writer's output is valid. The three todo tests name this item once `hitld adversary file --test <test> --fix HITLD-715` runs for each. Code: the owner's own yes to merge. Related: HITLD-654 (the glob break of the same pass, fixed).
