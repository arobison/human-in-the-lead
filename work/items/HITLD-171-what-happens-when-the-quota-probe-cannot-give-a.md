---
id: HITLD-171
title: What happens when the quota probe cannot give a reading
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: shouldn't it escalate that issue up to the orechestrator and eventually to you and then to me? seems like a good test of the system's overall escalation machinery
answered_at: 2026-11-16T01:34:50.418Z
answered_via: chat
answered_by: owner
---

## Question

What should happen when the quota probe cannot give a reading, because it was denied, failed or printed a format the parser does not recognize?

The orchestrator's permission system has denied other commands. Raised for HITLD-165.

Reversibility: two-way.

## Options and recommendation

- A. Fall back to the declared estimate and say so: The gate uses the declared estimate, and the failure and its reason go in the ledger and the next digest once.
- B. Stop dispatch until a reading exists: No new work starts without a fresh measurement or a declared figure.
- C. Fall back quietly: Use the declared estimate and record nothing about the failure.

Recommended: Fall back to the declared estimate and say so. Work keeps running on the best estimate and the failure is not lost.

## Answer

Recorded in the front matter once answered.
