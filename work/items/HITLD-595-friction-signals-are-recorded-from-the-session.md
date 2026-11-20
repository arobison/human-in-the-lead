---
id: HITLD-595
title: Friction signals are recorded from the session record, as events with a class, a source and an evidence reference
kind: work
state: planned
created: 2026-11-20
project: HITLD-15
---

## Why

The owner asked on 2026-11-20 how to start building the self-learning loop, for example the chief of staff introspecting on its interactions with the owner and its delegates to find friction and propose improvements, and said to build the signals. A first retrospective over this run (HITLD-589) showed that most of the friction is already recorded as events in the harness's session record: questions dropped by restarts (10 of 10 coincided with an interrupt and a restart in the same minute), owner replies lost while a question box was open, the owner repeating a standing instruction after a compaction ("ask me one at a time", 4 times), the owner correcting a claim that went against a recorded decision (7 times), and the owner finding delegate problems before the system did. Today they are found by hand.

## What it should do

- **A scan** (`hitld friction scan`, name to be shaped) reads the harness's session record through the harness adapter (design part 15) and appends `friction` events to the ledger, each with: a class, a source (owner, delegate or system), an evidence reference (the event or message ID and its timestamp, no copied text beyond a short quote), the decision count at that moment (so rates can be taken per decision, not per day), and a cause tag when the class has one. It is idempotent: a second scan of the same record adds nothing.
- **Deterministic classes first** (no model): a question dropped, a question asked again, a worker restart, a tool call interrupted by the owner, a compaction, an owner reply lost while a box was open, a permission denial that blocked a delegate.
- **Semantic classes by an independent reader**, not the chief of staff (design part 18.3: the system does not grade its own work): an owner correction of a claim, a repeated instruction, work the owner did that the system should have, a question that bundled several decisions or asked for something already decided. A small model classifies, always with an evidence quote and a confidence, and the cheapest rung that agrees with a sample the owner has rated is used (the cascade, HITLD-581). Nothing is guessed: an unclassified message is left unclassified.
- **The starting classes** come from the first retrospective's findings (F1 to F14 in its report), refined as the controller (HITLD-596) learns which classes matter.
- The events carry no project secrets and no private names. They live in the private store beside the ledger (per project, HITLD-490).
- **Corrections tagged as they happen:** from now on the chief of staff session also records an owner correction or repeat as a `friction` event when it recognizes one, with the same fields, marked as self-recognized so the independent reader can compare.

## Done when

- The missing information is obtained first (the shape is settled in HITLD-594; the event fields, the command name and the classifier's sample are shaped), then a failing test that reproduces the gap: this run's dropped questions and repeated instructions appear in no ledger (design part 14.7).
- A scan of a fixture session record yields the expected events for each deterministic class and is idempotent; the semantic classes are tested against a hand-rated sample.
- The design parts on self-improvement (18.4, implicit friction signals) say it, in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The owner asked to build the signals now. The weekly usage reading was 0.90 on 2026-11-20, above the 25 percent reserve, so autonomous work is stopped (HITLD-422): this item is first on the start list at the reset (19:00 UTC) and is promoted to `planned` on the owner's instruction. Code and schema: the owner's own yes to merge. Placed under HITLD-408 c4 (friction counts come from the ledger) by the chief of staff, a proposal for the owner to move earlier. Related: HITLD-48 and 154 (implicit friction signals), HITLD-139 and 585 (spend by role), HITLD-570 (the preference record), HITLD-596 (the controller that uses these signals), HITLD-589 (the first retrospective).

## Moved on 2026-11-20 (HITLD-608)

On the owner's decision HITLD-608, this item moved from milestone HITLD-408 (c4) to milestone HITLD-403 (c5), beside the fuller curator (HITLD-583 and HITLD-220), in release stage rc.4.
