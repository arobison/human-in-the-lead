---
id: HITLD-529
title: The trust record is derived from the ledger and tracker
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. Derived from the ledger and tracker: A kind's mode is the latest signed unlock decision minus any re-lock event; its evidence is computed from ledger events and tracker records on demand; no separate counter"
answered_at: 2026-11-19T21:37:02.987Z
answered_via: question-tool
answered_by: owner
---

## Question

Where does the trust record live?

Design 2.15 keeps trust as counts per area. HITLD-486: the ledger is one file per writer in the private store; HITLD-527: the engine's concept is supervision modes with an order.

## Options and recommendation

- A. Derived from the ledger and tracker: A kind's mode is the latest signed unlock decision minus any re-lock event; its evidence is computed from ledger events and tracker records on demand; no separate counter
- B. A separate stored record: The engine keeps its own trust file per project
- C. Derived, with a cached view: Computed as above, with a cached summary for the dashboard that is rebuilt rather than trusted

Recommended: Derived from the ledger and tracker. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
