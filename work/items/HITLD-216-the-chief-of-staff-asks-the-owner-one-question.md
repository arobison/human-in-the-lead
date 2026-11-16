---
id: HITLD-216
title: The chief of staff asks the owner one question per call, short, and keeps a queue it offers in batches
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

The owner has said, in the first self-hosted run, that they find the question box much easier to use than paragraphs, that the chief of staff's text should be more terse, and that choices should be put one at a time. Their attention budget is the scarce resource: some days it is small, and they want short questions they can answer in a few minutes. In the run the chief of staff several times asked three questions in one call and wrote paragraphs where one line would do.

## Done when

- The chief-of-staff skill says: put a choice to the owner with the question tool, one question per call, short option text, the recommendation first; write short replies; give the uncomfortable fact in the first line.
- The skill says the chief of staff keeps a queue of the owner's open questions (held design items, wording choices, approvals) and offers it in batches sized to the time the owner has ("give me a batch, N minutes"), highest value first, never as a pile.
- Each answer is recorded as a decision with `hitld rights record` before anything is built on it (HITLD-134).
- An eval scenario shows a chief of staff with three open choices asking them in three calls, and one with a stated time budget picking the most valuable.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The owner's instructions, 2026-11-16: ask one at a time, use the question box, terse; their attention budget will be very small for some days and they want "small stuff with easy questions". Related to HITLD-135 (the walk-through skill, for design questions) and HITLD-154 (a wait that eats attention). Filed under HITLD-181.
