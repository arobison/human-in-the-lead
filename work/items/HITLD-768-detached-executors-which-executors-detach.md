---
id: HITLD-768
title: "Detached executors: which executors detach"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Every print-mode executor becomes a detached headless process: Each is its own claude -p process in a new process group with a pid and result file; no in-process subagents in print mode."
answered_at: 2026-11-22T02:43:53.973Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-746 question 1: which executors does detached cover?

Today a print-mode orchestrator runs tier-2 executors as in-process subagents and tier-3 headless ones as claude -p in its own background shell; both die when the orchestrator exits.

## Options and recommendation

- A. Every print-mode executor becomes a detached headless process: Each is its own claude -p process in a new process group with a pid and result file; no in-process subagents in print mode.
- B. Only tier-3 headless runs detach: Tier-2 subagents stay.
- C. Print-mode orchestrators never host executors: Executors are always separate sessions.

Recommended: Every print-mode executor becomes a detached headless process. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
