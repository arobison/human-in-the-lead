---
id: HITLD-847
title: The dashboard and the quota report show dollars beside tokens, by run, item, model and tier, orchestrators against executors
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-846]
constraint_of: [HITLD-192 c3]
---


## Why

The dashboard's spend panel and `hitld quota report` show tokens only: ledger total, tokens by model and tier, tokens per merged item (`core/lib/quota/report.mjs`). The owner asked on 2026-11-22 to understand spend in tokens and dollars.

## Done when

- The spend panel, the text report and the dashboard data contract show dollars beside tokens: per run, per item, per merged item, per model and tier, with orchestrator overhead apart from executor work, and say which figures are reported and which computed.
- A figure with no measured cost shows as unknown, never zero.
- Tests render a ledger with reported, computed and missing costs. `npm run check`, the offline eval gate and `hitld work check` pass.

## Moved out of rc.2 on 2026-11-22

Moved from Consumer live (HITLD-67) on the owner's decision HITLD-874, after the plan review found rc.2 could not converge. It keeps its other milestone links.
