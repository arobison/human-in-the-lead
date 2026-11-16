---
id: HITLD-178
title: How to reconcile the orchestrator's ledger with the shared store
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Build HITLD-74 first, then reconcile: Per-machine ID blocks go in first so both ledgers can merge cleanly, with no reuse and no workaround. The orchestrator's records stay in its container, backed up as files, until then."
answered_at: 2026-11-16T02:02:06.717Z
answered_via: question-tool
answered_by: owner
---

## Question

How should the orchestrator's ledger, which conflicts with the shared store, be reconciled?

The orchestrator's store pull stopped on a conflict: both containers started a ledger at event E-1 with different content. Adopting the shared store has no sanctioned command, and would reuse dispatch numbers D-1 to D-9, which already appear as Dispatch trailers on main. That is what HITLD-74 fixes.

Reversibility: two-way.

## Options and recommendation

- A. Build HITLD-74 first, then reconcile: Per-machine ID blocks go in first so both ledgers can merge cleanly, with no reuse and no workaround. The orchestrator's records stay in its container, backed up as files, until then.
- B. Adopt anyway and accept the D-number reuse: The orchestrator backs up its folder, tries an untested empty-data-folder route, rebuilds its run state, and later dispatches reuse D-1 to D-9.
- C. Leave the orchestrator's ledger local until v0.1.0: No store merge for now, and the records are lost if the container is reclaimed.

Recommended: Build HITLD-74 first, then reconcile. It avoids the number reuse and an unsanctioned workaround.

## Answer

Recorded in the front matter once answered.
