---
id: HITLD-160
title: rights record leaves a decision item behind when the trust event is invalid, and refuses a question with no structured attributes
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

`hitld rights record` (HITLD-134) is meant to check everything before it writes anything, so a refusal leaves no trace. When the owner's choice was recorded for a question with no areas, paths, tags or triggers, the command failed with "trust event is invalid: facts must have at least 1 key" after it had already written the decision item, and it did so twice, leaving two decision items with no answer and no ask record. The same questions recorded cleanly once a tag was added. The chief of staff found this recording the owner's first two design decisions.

## Done when

- A question with no structured attributes is recorded as a choice, with facts the trust event accepts, or is refused before anything is written, with a message that says which attribute to add. A refusal leaves no decision item, ask record, ledger event or trust event.
- A test records a question with no areas, paths, tags or triggers, once through the question tool and once in chat, and checks the result and, for a refusal, that nothing was written.
- The check that every refusal happens before any write covers the trust event's validity as well as the channel, the code and the words.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the chief of staff in the first self-hosted run, with the two stray items (created and removed by hand before the retry) as the evidence. It fixes a gap against HITLD-134's own Done-when, so it is a bug and not a design change.
