---
id: HITLD-673
title: How does orch-4 get the store repository attached so its ledger can be stored?
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: A. Allow the attach, and make it automatic in future|The owner allows add_repo for the orchestrator (a permission rule or approval), and HITLD handles the grant automatically from now on; filed as a feature request.
answered_at: 2026-11-21T06:48:28.645Z
answered_via: chat
answered_by: owner
---

## Question

Orch-4 cannot reach the private store because the store repository is not attached to its session, and the harness refused its attach. Which route?

Orch-4's device key is set and matches the approved device. Its attach was refused by the harness permission check, so only the owner can allow it.

## Options and recommendation

- A. A: Allow the attach, and make it automatic in future|The owner allows add_repo for the orchestrator (a permission rule or approval), and HITLD handles the grant automatically from now on; filed as a feature request.
- B. B: Owner attaches the store repository themselves|The owner adds it as a source in the session.
- C. C: Keep waiting for a successor|Leave the ledger in orch-4's container; merges are recoverable from their Dispatch trailers.

Recommended: A. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
