---
id: HITLD-518
title: What makes a change verifiable for self-merging
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. Mechanical only: A command scores it: a test that fails on the base and passes on the change, or an eval covering the changed behavior; every check green including CodeQL; cleanly revertible; no never-unlock path touched; no model opinion in the gate"
answered_at: 2026-11-19T21:21:43.019Z
answered_via: question-tool
answered_by: owner
---

## Question

What counts as verifiable, and who scores it?

HITLD-472 and HITLD-482: a change in an unlocked kind may self-merge only if its checks could have caught a wrong version. Both gates apply: the kind has earned the unlock bar from history (HITLD-478), and each change is verifiable (HITLD-482). The change's author never scores it.

## Options and recommendation

- A. Mechanical only: A command scores it: a test that fails on the base and passes on the change, or an eval covering the changed behavior; every check green including CodeQL; cleanly revertible; no never-unlock path touched; no model opinion in the gate
- B. Mechanical plus an independent reviewer: As above, and for code changes a separate agent must agree
- C. Set it per kind: Each kind's rule is decided when it is proposed for unlocking

Recommended: Mechanical only. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
