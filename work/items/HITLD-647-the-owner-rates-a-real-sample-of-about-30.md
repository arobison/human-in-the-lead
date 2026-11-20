---
id: HITLD-647
title: The owner rates a real sample of about 30 messages from a session, to calibrate the friction reader (HITLD-595 follow-up)
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-595]
---

## Done when

- `hitld friction messages` extracts the messages of a real session record, and the owner rates about 30 of them (the class, or none), so the rating is the owner's own and no raw session text is committed to the repository.
- The independent reader is run against the sample, and `agreement()` reports how often it matches the owner's ratings, per class, with the sample size stated.
- The result decides the rung of the execution cascade the semantic reader runs on (HITLD-581): the cheapest one whose agreement meets a floor the owner sets.
- `hitld work check` passes.

## Why

The friction signals (HITLD-595, pull request merged on the owner's yes) record semantic classes (owner correction, repeated instruction, owner did the work, bundled question, already decided) only from an independent reader's output. The reader's test uses a synthetic sample rated by the executor, so how well it agrees with the owner is not measured.

## Notes

Raised by the HITLD-595 executor's report. It is the owner's rating, so it needs the owner's attention but not much: about 30 messages. Related: HITLD-596 (the friction controller), HITLD-581 (execution profile), HITLD-570 (the preference record).  Placed under HITLD-403 clause c5 (rc.4), beside the friction signals, as a proposal for the owner to move. Needs HITLD-595 to be merged.
