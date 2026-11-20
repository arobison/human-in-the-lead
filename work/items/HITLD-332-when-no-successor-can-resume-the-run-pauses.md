---
id: HITLD-332
title: When no successor can resume, the run pauses cleanly and tells the owner
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Pause cleanly and tell the owner: A recorded pause; nothing starts until the owner answers."
answered_at: 2026-11-16T16:54:13.399Z
answered_via: question-tool
answered_by: owner
---

## Question

When no successor can resume, what should happen?

HITLD-323: a successor orchestrator in a fresh cloud container cannot resume when the store sync is refused.

## Options and recommendation

- A. Pause cleanly and tell the owner: A recorded pause; nothing starts until the owner answers.
- B. Start a fresh run automatically: A new run starts from the tracker.
- C. Not now: Leave the behavior.

Recommended: Pause cleanly and tell the owner. No silent stall, and no automatic loss of calibration.

## Answer

Recorded in the front matter once answered.
