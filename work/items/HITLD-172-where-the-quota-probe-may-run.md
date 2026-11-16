---
id: HITLD-172
title: Where the quota probe may run
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Wherever the gate needs a reading: The orchestrator's container probes for its dispatch decisions and the chief of staff for the digest and status, with each reading written to the store when it is reachable."
answered_at: 2026-11-16T01:34:53.402Z
answered_via: question-tool
answered_by: owner
---

## Question

Where may the quota probe run?

It needs the claude command and its credentials, which every cloud container and the owner's machine have. Raised for HITLD-165.

Reversibility: two-way.

## Options and recommendation

- A. Wherever the gate needs a reading: The orchestrator's container probes for its dispatch decisions and the chief of staff for the digest and status, with each reading written to the store when it is reachable.
- B. Only the chief of staff's session: One place probes and the orchestrator reads the result from the store.
- C. Only on the owner's own machine: The owner's machine probes and the result travels through the store.

Recommended: Wherever the gate needs a reading. Each place gets a fresh reading when it needs one, and the store lets others reuse it.

## Answer

Recorded in the front matter once answered.
