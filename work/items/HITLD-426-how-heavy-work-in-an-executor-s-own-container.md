---
id: HITLD-426
title: How heavy work in an executor's own container is admitted
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "B. Read that container's load: The executor reports its container's load and memory before heavy work and the gate uses it."
answered_at: 2026-11-16T22:17:21.584Z
answered_via: question-tool
answered_by: owner
---

## Question

How should heavy work an executor runs in its own container be admitted: recorded as unchecked, or by reading that container's load?

The orchestrator's machine load does not measure it.

## Options and recommendation

- A. Recorded as unchecked: The plan and ledger say it ran unchecked; the plan quota binds it.
- B. Read that container's load: The executor reports its container's load and memory before heavy work and the gate uses it.

Recommended: Recorded as unchecked. Simplest, no new reporting; the owner chose the accurate reading instead.

## Answer

Recorded in the front matter once answered.
