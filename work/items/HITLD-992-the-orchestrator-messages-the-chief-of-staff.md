---
id: HITLD-992
title: The orchestrator messages the chief of staff only when something changed, and batches what changed in a pass into one message
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The orchestrate skill says to send the chief of staff a message only for a merge ready, a question, a start request, a relay, a wake time change or a handover; a pass with none of those sends no message.
- A pass that changes several things sends one message with all of them; a skill eval scenario checks both cases.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Each message from the orchestrator wakes the chief of staff for a turn that re-reads its whole context, including turns that only report waiting. Serves the owner's token budget.

## Notes

rc.3. From the owner's request of 2026-11-24 to keep the token use of the chief-of-staff chat down without breaking the long-running chat: one chief-of-staff session read billions of cache-read tokens in eight days, because every model call re-reads the whole context, so cost grows with context size times the number of calls.
