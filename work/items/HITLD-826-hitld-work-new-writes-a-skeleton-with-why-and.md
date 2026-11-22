---
id: HITLD-826
title: `hitld work new` writes a skeleton with Why and Done when, and `work check` warns on an empty section
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-191 c2]
---


## Why

`hitld work new` leaves an empty `## Done when` heading. On 2026-11-22 four items filed in a hurry carried that empty heading above a second one the author appended, and the format check did not mind.

## Done when

- `hitld work new` accepts `--why` and `--done-when` (repeatable) and writes the sections; with neither it writes `## Why` and `## Done when` with a placeholder line that `work check` flags.
- `work check` warns on an item with an empty section or a repeated heading.
- Tests cover each. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
