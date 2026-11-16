---
id: HITLD-335
title: HITLD-153 goes first by making the Windows follow-ups depend on it
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: Just make other things depend on it so the scheduler naturally picks it up
answered_at: 2026-11-16T17:07:43.951Z
answered_via: chat
answered_by: owner
---

## Question

How should HITLD-153 (a finished-but-unmerged item holds a planner slot) get built soon?

The planner ranks by how many items an item unblocks, and has no priority key; the owner chose the same ordering mechanism used for HITLD-52 and HITLD-152.

## Options and recommendation

- A. Make other items depend on it: HITLD-249 to 252 gain a needs edge on HITLD-153, so it ranks above them and the scheduler picks it up.
- B. Tell the orchestrator to start it: The orchestrator is told to treat it as the next critical item.
- C. Leave it behind HITLD-152: It waits.

Recommended: Make other items depend on it. No manual override needed.

## Answer

Recorded in the front matter once answered.
