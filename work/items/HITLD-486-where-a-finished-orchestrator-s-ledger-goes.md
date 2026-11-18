---
id: HITLD-486
title: Where a finished orchestrator's ledger goes
kind: decision
state: done
created: 2026-11-18
project: HITLD-15
decider: owner
answer: "A. Private store, one file per orchestrator: Each orchestrator pushes its own ledger file as it goes; needs the cloud store enrollment fixed (HITLD-323, 333)."
answered_at: 2026-11-18T05:37:36.118Z
answered_via: question-tool
answered_by: owner
---

## Question

Where should a finished orchestrator's ledger go, so a successor and the estimator can read it?

With orchestrator-numbered IDs (HITLD-485) nothing needs to merge: each orchestrator can write its own file.

## Options and recommendation

- A. Private store, one file per orchestrator: Each orchestrator pushes its own ledger file as it goes; needs the cloud store enrollment fixed (HITLD-323, 333).
- B. The chief of staff archives it: Orchestrators send completions to the chief of staff, which keeps the archive.
- C. A summary in the tracker repository: Completion records as a public file under work/.
- D. Tell me more first: Trade-offs first.

Recommended: Private store, one file per orchestrator. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
