---
id: HITLD-160
title: rights record leaves a decision item behind when the trust event is invalid, and refuses a question with no structured attributes
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
claimed_by: D-44
---

## Why

`hitld rights record` (HITLD-134) has two defects. The second: a link given to it is not written to the decision item. The first: it is meant to check everything before it writes anything, so a refusal leaves no trace. When the owner's choice was recorded for a question with no areas, paths, tags or triggers, the command failed with "trust event is invalid: facts must have at least 1 key" after it had already written the decision item, and it did so twice, leaving two decision items with no answer and no ask record. The same questions recorded cleanly once a tag was added. The chief of staff found this recording the owner's first two design decisions.

## Done when

- A link given to `rights record` is written: `opened_from` (and `blocks`, which gives the blocked item a `needs` link) appears on the decision item, so a recorded decision can be traced to the items it concerns. Today the decision items HITLD-158 to HITLD-174 carry the answer and no link.

- A question with no structured attributes is recorded as a choice, with facts the trust event accepts, or is refused before anything is written, with a message that says which attribute to add. A refusal leaves no decision item, ask record, ledger event or trust event.
- A test records a question with no areas, paths, tags or triggers, once through the question tool and once in chat, and checks the result and, for a refusal, that nothing was written.
- The check that every refusal happens before any write covers the trust event's validity as well as the channel, the code and the words.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the chief of staff in the first self-hosted run, with the two stray items (created and removed by hand before the retry) as the evidence. It fixes a gap against HITLD-134's own Done-when, so it is a bug and not a design change.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (472/507,333/409): rights record trust event. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); answers, proof and contributors (HITLD-515 to 517). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.

## Plan audit on 2026-11-20 (still valid as written)

Checked against the trust-engine decisions (HITLD-518 to HITLD-529, HITLD-547, HITLD-548) and the answer-proof decisions (HITLD-515 to HITLD-517). This item fixes the built behavior of `hitld rights record`, which writes the built per-area trust event. The derived trust record replaces that event only when the engine is built (HITLD-529; builds HITLD-552 to HITLD-556), and the trust calibration section of the loops design keeps the built record in force until then. The proof field on the answer record is a separate build (HITLD-564) and does not change this fix. No rewording.
