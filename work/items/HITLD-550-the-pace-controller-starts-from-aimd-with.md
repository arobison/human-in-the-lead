---
id: HITLD-550
title: The pace controller starts from AIMD with conservative gains
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. AIMD, conservative gains: Additive increase while the account total is below the line, multiplicative decrease when above; known to converge to fair shares among blind senders; also adapts executor concurrency (HITLD-534); slow gains for the feedback delay; the study may swap it on evidence"
answered_at: 2026-11-19T23:42:04.543Z
answered_via: question-tool
answered_by: owner
---

## Question

What should the pace controller start from?

HITLD-549: projects are blind to each other and share the pace through the account's total utilization. The probe reads about every 30 minutes and spend accumulates over hours, so feedback is delayed.

## Options and recommendation

- A. AIMD, conservative gains: Additive increase while the account total is below the line, multiplicative decrease when above; known to converge to fair shares among blind senders; also adapts executor concurrency (HITLD-534); slow gains for the feedback delay; the study may swap it on evidence
- B. Bands around the line: Today's fixed bands measured against the line
- C. A PID-style controller: Smooth control on the error from the line

Recommended: AIMD, conservative gains. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
