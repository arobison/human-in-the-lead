---
id: HITLD-436
title: A completion's token count cannot be corrected, and the estimator takes one outlier as the typical cost
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Done when




- A completion's recorded token count can be corrected by a supported command (or a `logged` event the ledger and the estimator both honor, with `corrects` naming the entry), so a wrong figure is fixed without editing the ledger by hand; the correction is itself in the ledger.
- `hitld dispatch complete --tokens` names what it counts (output tokens plus fresh input, not cache reads) and refuses or warns on a figure far above the planner's estimate for the item, so a cache-read total cannot be recorded as a cost by mistake.
- The estimator does not take a single completion as the typical cost: it uses a robust figure (for example the median with a minimum sample, or a cap relative to the estimate) and says when the sample is too small. A test covers one outlier among several normal completions.
- The gate's burn calculation does not read the token figure of a completion; if it does, a test shows an outlier cannot distort it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Found by the orchestrator on 2026-11-16 and reported by it: when it completed the headless run D-27 (HITLD-343, which ended `blocked` after 88 seconds and about 8k output tokens), it passed `--tokens 1882000`, the run's input plus cache-read total from the result file. The ledger then held 1,882,231 tokens against HITLD-343, `ledger summary` reported that as the cost per accepted item, and the planner's estimate for the next items became about 1.88M tokens each; a generated brief said "Budget: ~1882k tokens; report at 2823k". The real cost was about $1. There is no supported command that corrects a completion's token count.

## Notes

Related: HITLD-81 (agent-shaped estimates), HITLD-298 (`estimate_tokens` on), HITLD-139 and HITLD-112 (token accounting). Proposed milestone: HITLD-408 (HITLd measures its own work), clause c1; the owner places it.
