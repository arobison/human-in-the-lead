---
id: HITLD-543
title: A question to the owner is filed as a pending decision before it is asked, and re-asked on resume
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Why

A question box to the owner is dropped when the worker restarts (about a dozen times in three days, 2026-11-17 to 2026-11-19, and three more while the design walk-through of 2026-11-19 was running). The question lives only in the chief of staff's session, so a drop loses it and the chief of staff has to rebuild it from memory. The owner decided (HITLD-542) that every question to the owner is filed as a pending decision in the tracker before the box is shown. This is also the first step toward the service study (HITLD-508, HITLD-541): the same record is what a later web inbox or service would read.

## What it should do

- Before asking, the chief of staff files a pending decision (`kind: decision`, `state: planned`) holding the question, the options and the chief of staff's recommendation. A question asked while one is still pending is not filed twice.
- The owner's answer is recorded on that decision, which closes it (`hitld rights record`, HITLD-134), instead of creating a new one.
- On a resume or restart the chief of staff lists the pending decisions and re-asks each, one at a time, before anything else.
- The record carries the proof kind of the answer (HITLD-515): the harness-attested turn in the owner's session today.

## Done when

- The chief-of-staff skill says to file a pending decision before each question and to re-ask the pending ones on resume, in one change the owner approves.
- `hitld rights record` can close an existing pending decision with the owner's answer, and refuses to create a duplicate for a question that is already pending.
- A test or eval shows a dropped question is re-asked on resume from the pending decision.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Skill and code: the owner's own yes to merge. Placed under HITLD-405 c2 (one question per call, a queue offered in batches) by the chief of staff, a proposal for the owner to move. Related: HITLD-135 (design walk-throughs), HITLD-407 and HITLD-515 (answers and proof), HITLD-540 (stay in the harness), HITLD-441 (deferral).
