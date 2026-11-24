---
id: HITLD-853
title: The report parser accepts a call line ending (one-way), as the contract and the briefs say
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M860KVF993NCM9
---

## Why

On 2026-11-22 the HITLD-759 executor's report was refused four times by `dispatch complete`, once because a call line ended `(one-way)`. The contract and every brief say a call line ends `(reversible)` or `(one-way)`, but `core/lib/contract/report.mjs` (the REVERSIBLE pattern, line 23) accepts only `(reversible)`, so a one-way call can never be reported. The orchestrator did not mark anything falsely: it had the executor move the one-way step into deviations.

## Done when

- `parseReport` accepts a call line ending `(reversible)` or `(one-way)`, and refuses one that ends neither, naming the line; a one-way call is recorded as one-way, not as a reversible one.
- Tests cover each ending and a line with neither. A contract change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.
