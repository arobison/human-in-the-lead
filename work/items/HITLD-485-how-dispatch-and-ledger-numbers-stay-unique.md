---
id: HITLD-485
title: How dispatch and ledger numbers stay unique across orchestrators
kind: decision
state: done
created: 2026-11-18
project: HITLD-15
decider: owner
answer: "A. Orchestrator-numbered IDs: The chief of staff numbers each orchestrator it starts; its dispatches and events are D-4.1, D-4.2 and E-4.1. Existing D-1 to D-38 stay as they are."
answered_at: 2026-11-18T05:36:58.091Z
answered_via: question-tool
answered_by: owner
---

## Question

With no run object, how should dispatch and ledger event numbers stay unique across orchestrators, without needing the store to sync?

HITLD-74 proposed per-machine reserved blocks. The chief of staff starts every orchestrator, so it can number them.

## Options and recommendation

- A. Orchestrator-numbered IDs: The chief of staff numbers each orchestrator it starts; its dispatches and events are D-4.1, D-4.2 and E-4.1. Existing D-1 to D-38 stay as they are.
- B. Per-machine blocks (HITLD-74 as written): Reserved ranges per machine, with a migration.
- C. The chief of staff allocates every number: A single counter the chief of staff holds.
- D. Tell me more first: The trade-offs first.

Recommended: Orchestrator-numbered IDs. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
