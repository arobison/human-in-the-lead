---
id: HITLD-663
title: How should the six unstarted items of the 20 proceed while the start hold stands?
kind: decision
state: planned
created: 2026-11-20
project: HITLD-15
decider: owner
---

## Question

The harness now refuses interactive executor starts (a refused git reset --hard on one executor set it) and says headless only, which cannot run the project's commands. What do you want to do about HITLD-251, 252, 296, 300, 342 and 413?

Nothing queued for you depends on them: sixteen pull requests wait for your review and merge. A later clean completion did not lift the hold.

## Options and recommendation

- A. Wait: Start nothing new until the review queue is clear or you change the harness rule.
- B. Change the harness rule: You adjust the harness setting that refuses interactive starts; the orchestrator then continues.
- C. Start them headless: Try headless sessions despite the earlier refusals; the chief of staff reports what they can run.

Recommended: Wait. The review queue, not executor capacity, is the bottleneck.

## Answer

Open.
