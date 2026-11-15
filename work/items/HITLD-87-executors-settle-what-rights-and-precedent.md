---
id: HITLD-87
title: Executors settle what rights and precedent settle before asking
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

The executor contract escalates naming and cross-area changes on their own, and executors do not check `hitld rights` or precedent before listing a question. Each such question costs a partial report, a follow-up round trip and orchestrator context, often for something the system or an existing precedent decides.

## Done when

- Before listing a question, the executor runs `hitld rights who` and `precedent match`; if the system decides or a precedent fits, it decides, logs the call and cites the precedent.
- The contract's "not your call" list matches the decision rules instead of being broader than them.
- An offline eval scenario: a question a precedent settles is decided by the executor, not sent.

