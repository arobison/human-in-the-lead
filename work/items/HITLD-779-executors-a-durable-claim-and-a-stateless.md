---
id: HITLD-779
title: "Executors: a durable claim and a stateless reconciler, not detached processes"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Adopt B and file the follow-ups: A unit of work is a ledger dispatched event plus a claim branch; each orchestrator turn runs an idempotent reconcile pass that observes in-flight dispatches, records completions from the closing commit's report, refills and merges; a lost wake costs latency, never correctness; quota is handled at admission with per-executor budget caps."
answered_at: 2026-11-22T03:03:56.696Z
answered_via: question-tool
answered_by: owner
---

## Question

Adopt the durable-claim and stateless-reconciler model for executors, and reshape HITLD-746 and the guard gap around it?

An Opus exploration found the detached-process design treats issue 455 as a process-lifecycle problem when it is a completion-model problem: completion is a notice the orchestrator must be alive to receive. Push events are not a wake source outside pull requests in the cloud, and the executor guard says executors never push.

## Options and recommendation

- A. Adopt B and file the follow-ups: A unit of work is a ledger dispatched event plus a claim branch; each orchestrator turn runs an idempotent reconcile pass that observes in-flight dispatches, records completions from the closing commit's report, refills and merges; a lost wake costs latency, never correctness; quota is handled at admission with per-executor budget caps.
- B. Adopt B but check the guard gap first: A short verification job first.
- C. Keep the detached-process design: Continue HITLD-746 as walked through.

Recommended: Adopt B and file the follow-ups. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
