---
id: HITLD-804
title: An orchestrator session is started with permission rules for its owner-authorized commands, and each command runs only with a matching signed owner decision
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-254]
---

## Why

The owner decided (HITLD-803, 2026-11-22) how their decisions reach the orchestrator: standing allow rules plus a signed decision check. On 2026-11-22 orch-6's harness refused `dispatch start` because the owner's list came through the chief of staff and not through a message typed in its own session, and the run's cap of 2 (HITLD-204) could not be raised without the owner typing in that session. The owner wants never to talk to the orchestrator.

## Done when

- At run start, hitld writes permission rules for the orchestrator session that allow a short list of its commands: `dispatch start`, `dispatch follow-up`, `config write person` and `config write machine`, `run start --replace`, `run resume` and `quota declare`. The list is data in the settings, not code. `store attach` is not on it: the store address is the owner's to give.
- Each listed command, before it acts, finds a signed owner decision in the store that names it (HITLD-36, signed answers: the owner's answer, the question and the time) and refuses with a typed fault naming the missing decision when there is none.
- Every use is a `rights log` entry; a revoked decision makes the command refuse at once, and the rules are rewritten at the next run start.
- Tests cover a command with a matching decision, one without, a revoked one, and a command outside the list. `npm run check`, the offline eval gate and `hitld work check` pass.
- A permission and guard change reaches main only with the owner's own yes.

