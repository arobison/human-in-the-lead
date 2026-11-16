---
id: HITLD-321
title: "What goes first when the next executor slot frees: HITLD-152"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. HITLD-152 first: HITLD-52 gets a needs edge on HITLD-152, so the dashboard ranks above it."
answered_at: 2026-11-16T06:49:56.023Z
answered_via: question-tool
answered_by: owner
---

## Question

When the next slot frees, the planner offers HITLD-109 and HITLD-52, not HITLD-152 or the Windows follow-ups. What should go first?

HITLD-52 is large (about 1.47M tokens). The planner has no priority key; ordering is by needs.

## Options and recommendation

- A. HITLD-152 first: HITLD-52 gets a needs edge on HITLD-152, so the dashboard ranks above it.
- B. Windows follow-ups first: HITLD-249 to 252 go first.
- C. Let the planner decide: HITLD-52 goes first; 152 waits for the planner fix.

Recommended: HITLD-152 first. The owner wants the dashboard views and has reviewed the board.

## Answer

Recorded in the front matter once answered.
