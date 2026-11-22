---
id: HITLD-846
title: The usage of each executor and orchestrator session, with its dollars, reaches the ledger when its work completes
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---


## Why

On 2026-11-22 the owner asked whether dollars can be shown beside tokens. The ledger has a place for them (`usage.cost_usd`, HITLD-438), but no completion in the run recorded tokens or cost: every `dispatch complete` warned that no session record was given, because the orchestrator cannot read an executor's session record and only the chief of staff can (the session tool returns its usage block: input, output, cache write and read tokens, and `cost_usd`). Orchestrators' own cost (orch-6 about 9.70 dollars, 390k tokens of context) was never recorded either. The harness's `cost_usd` is an API-equivalent estimate, not a subscription charge.

## Done when

- `hitld dispatch complete` accepts a usage block (`--usage <file or JSON>`: input, output, cache write and cache read tokens, and `cost_usd` when known) and records it as measured (`tokens_source: session-record`); the chief-of-staff skill says to read an executor's session usage when its report arrives and pass it to the orchestrator in the relay line, and to read the orchestrator's own usage at handover and record it as run overhead.
- A price table in policy (`pricing.models.<model>`: input, output, cache write and cache read per million tokens) turns tokens into dollars only when the harness gives no `cost_usd`; every entry says `cost_source: reported` or `computed`.
- Tests cover a completion with a usage block, one without, a computed cost and a reported one. A ledger, policy and skill change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.
