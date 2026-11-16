---
id: HITLD-161
title: How an orchestrator makes sure every executor reports up the chain
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Generated block, enforced at start, watched: hitld dispatch writes the communication block into every brief with the orchestrator's session ID, dispatch start refuses a brief without it, and dispatch watch flags an executor whose session ended with no report. A Stop hook is added later only if HITLD-144's test shows it works."
answered_at: 2026-11-16T01:11:30.365Z
answered_via: question-tool
answered_by: owner
---

## Question

How should an orchestrator make sure every executor reports to it before the executor's turn ends?

The owner's rule is that an executor never ends a turn without passing a message up the chain. In the first self-hosted run two executors finished without sending anything, and the orchestrator waited on a report that never came. Raised for HITLD-147.

Reversibility: two-way.

## Options and recommendation

- A. Generated block, enforced at start, watched: hitld dispatch writes the communication block into every brief with the orchestrator's session ID, dispatch start refuses a brief without it, and dispatch watch flags an executor whose session ended with no report. A Stop hook is added later only if HITLD-144's test shows it works.
- B. Skill instruction only, watch as a backstop: The orchestrate skill tells the orchestrator to paste the block by hand, and dispatch watch flags an executor that ended with no report. Nothing refuses a brief that lacks the block.
- C. Wait for the Stop-hook test: Nothing new until HITLD-144's test shows whether a Stop hook can force a message before a turn ends. The manual paste continues meanwhile.

Recommended: Generated block, enforced at start, watched. A rule that depends on someone remembering to paste a block is the one that failed.

## Answer

Recorded in the front matter once answered.
