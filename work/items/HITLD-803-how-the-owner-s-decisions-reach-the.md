---
id: HITLD-803
title: How the owner's decisions reach the orchestrator's permission checks
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Allow rules plus a signed decision check: At run start hitld writes permission rules allowing a short list of orchestrator commands; each runs only if a matching signed owner decision exists in the store; every use is logged and a rule can be revoked."
answered_at: 2026-11-22T05:47:45.298Z
answered_via: question-tool
answered_by: owner
---

## Question

How should the owner's decisions in the chief of staff session reach the orchestrator, so the owner never types in its session?

The orchestrator's session cannot see the owner's answers in the chief of staff session, so the permission classifier blocks commands such as dispatch start, config write and run start --replace. HITLD-254 asked for a design.

## Options and recommendation

- A. Allow rules plus a signed decision check: At run start hitld writes permission rules allowing a short list of orchestrator commands; each runs only if a matching signed owner decision exists in the store; every use is logged and a rule can be revoked.
- B. Signed decision check only: Each command checks for a signed owner decision; the classifier may still block the call.
- C. I make the call from my session: A narrow chief of staff command starts executors and records the handle.
- D. Surface the prompt to me: Denied commands are forwarded to the chief of staff as typed faults; the owner still answers each.

Recommended: Allow rules plus a signed decision check. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
