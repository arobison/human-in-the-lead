---
id: HITLD-679
title: May the dispatch backfill use --by-hand for the first run's finished dispatches?
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: "A. Leave it, file an import command: The queue works without these records. File an item for a supported way to import finished dispatches; HITLD-676 stays open for them."
answered_at: 2026-11-21T16:38:03.434Z
answered_via: question-tool
answered_by: owner
---

## Question

The ledger's raw append refuses dispatch records, and the only route to record a finished dispatch is dispatch start --by-hand, which the standing rule forbids. Make an exception for the one-time backfill?

Orch-5 recorded 21 logged events, 14 verified-pass events and 8 merged events from the handover note and the trailers; the queue works without the dispatch records.

## Options and recommendation

- A. Leave it, file an import command: The queue works without these records. File an item for a supported way to import finished dispatches; HITLD-676 stays open for them.
- B. Allow --by-hand for the backfill: Orch-5 records the 21 dispatches with --by-hand once, marked as backfilled; a one-time exception to the standing rule.

Recommended: Leave it, file an import command. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
