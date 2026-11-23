---
id: HITLD-800
title: The design text says the default reserve is 10 percent
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-799]
constraint_of: [HITLD-71 c?]
---

## Why

HITLD-799 changes the package default for the quota reserve from 25 percent to 10 percent on the owner's decision (2026-11-22). Part 12.5 of the design and Q11 in the open questions say 25 percent, and `docs/` changes only through the curator job and a design PR.

## Done when

- Part 12.5 and Q11 state a 10 percent default and say the owner changed it on 2026-11-22, with the reason (25 percent held a run at one executor at 58 percent of the week used).
- The design PR reaches main only with the owner's own yes. `npm run check` and `hitld work check` pass.

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-973 (2026-11-23).
