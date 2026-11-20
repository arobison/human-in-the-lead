---
id: HITLD-619
title: Most of the measurement complexity lives in dyno, not in HITLD
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: i want most of that complexity to live in dyno
answered_at: 2026-11-20T02:52:22.741Z
answered_via: chat
answered_by: owner
---

## Question

How much of the local, remote-driven and farm measurement complexity should HITLD model?

The owner said dyno measures locally or by driving a remote machine over a network, and may drive a farm of dedicated test machines.

## Options and recommendation

- A. Most of it in dyno: HITLD asks for a measurement and gets a result; dyno owns targets, the farm, reservation, queueing, locks and comparability
- B. HITLD models targets and the farm: HITLD keeps its own registry of test machines and locks

Recommended: Most of it in dyno. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
