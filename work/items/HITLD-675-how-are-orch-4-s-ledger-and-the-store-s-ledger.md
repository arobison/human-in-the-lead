---
id: HITLD-675
title: How are orch-4's ledger and the store's ledger reconciled after the pull conflict?
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: "A. Backfill from the store: Orch-4 never pushes its ledger. A successor orchestrator starts from the store and re-appends orch-4's starts and merges as new events, taken from its handover note and the Dispatch trailers on main."
answered_at: 2026-11-21T07:32:56.959Z
answered_via: question-tool
answered_by: owner
---

## Question

Orch-4's old-format ledger and the store's old-format ledger both hold an event E-1 with different content, so a pull stops. Merging pull request 393 did not change that (confirmed by experiment). What now?

Orch-4's pull stopped on a conflict with nothing merged. The experiment ran the same clash on main and on the 393 code; both stop with the same error.

## Options and recommendation

- A. Backfill from the store: Orch-4 never pushes its ledger. A successor orchestrator starts from the store and re-appends orch-4's starts and merges as new events, taken from its handover note and the Dispatch trailers on main.
- B. Move orch-4's events into a writer file: Orch-4 rewrites its events under new IDs in its own per-writer file, then pulls and pushes. Manual, and breaks citations of the old IDs.
- C. Leave it: Keep the ledger in orch-4's container; merges stay recoverable from their Dispatch trailers.

Recommended: Backfill from the store. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
