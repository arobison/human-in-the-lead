---
id: HITLD-427
title: Where the owner hold on the run lives
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. In the run, by a command: hitld run hold and hitld run release, recorded in the ledger; the plan offers nothing while held; running executors continue; a new run starts released."
answered_at: 2026-11-16T22:18:13.272Z
answered_via: question-tool
answered_by: owner
---

## Question

Where should the owner hold (start nothing until the owner says) live?

A needs edge per held item does not stop the scheduler.

## Options and recommendation

- A. In the run, by a command: hitld run hold and hitld run release, recorded in the ledger; the plan offers nothing while held; running executors continue; a new run starts released.
- B. In the person file: A persistent setting across runs and machines.
- C. In project policy: A public setting changed by PR.

Recommended: In the run, by a command. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
