---
id: HITLD-379
title: Lowering the critical threshold so HITLD-343 can start
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Lower it to 10%: The owner's person file sets quota.critical_below to 0.10; the reserve is untouched; reverted later."
answered_at: 2026-11-16T18:39:59.909Z
answered_via: question-tool
answered_by: owner
---

## Question

Lower the owner's person setting quota.critical_below from 15% to 10% so the usage gate runs in economize mode and HITLD-343 starts by the plain route (the 25% reserve unchanged)?

HITLD-343 is held by the gate (critical path only); by-hand does not skip the gate until HITLD-355 is built, and its permission check blocked by-hand.

## Options and recommendation

- A. Lower it to 10%: The owner's person file sets quota.critical_below to 0.10; the reserve is untouched; reverted later.
- B. Wait for the window reset: HITLD-343 starts on 2026-11-20 at 19:00Z or when usage drops.
- C. Tell orch-3 yourself: Fixes the permission block, not the gate.

Recommended: Lower it to 10%. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
