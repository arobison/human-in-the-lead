---
id: HITLD-597
title: Before it claims state or asks a question, the chief of staff looks the decision up, and a list of retired terms flags stale wording
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
constraint_of: [HITLD-405 c1]
---

## Why

The first retrospective of this run (HITLD-589, finding F2) counted 7 times in about 300 questions that the owner corrected a claim or question that went against a recorded decision, and 4 of them came right after a compaction. The chief of staff states design facts from memory, not from the tracker. HITLD-146 checks claims against the design and code but not against the decision log, and HITLD-543 refuses a duplicate pending question, not an already answered one.

## What it should do

- Before a question to the owner, or a claim that something is "still open", "the only source", "new" or "not built", run a deterministic search of the decision items (by item ID and key terms, including answers given in the session). Name the decision found, or say "no decision found".
- Keep a short list of retired terms taken from decisions that drop a concept (run, discrete tier, status line, long outcome, contribution) and flag outgoing question text that uses one.
- Measure: owner corrections whose cause is a missed decision or a superseded term, per 100 questions (7 in 298 in this run).

## Done when

- The missing information is obtained first (the proposal is from the retrospective, HITLD-589; shape it with the owner), then a failing test or eval that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test, and the design parts it affects are updated in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Skill wording and a deterministic check; the owner's own yes to merge. The chief of staff adopted this as a working practice on 2026-11-20 before it is built. Placed under HITLD-405 c1 (a claim cites the design, the code or a command) by the chief of staff, a proposal for the owner to move. Related: HITLD-146, 543, 570.
