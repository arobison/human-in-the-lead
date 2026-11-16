---
id: HITLD-189
title: Fast, reliable CI and a planner that offers the right work
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: The owner is not held up by slow checks or by a planner that cannot start what is ready.
done_when:
  - "c1: The CI and eval gates give the same answer on every run, and checks an executor cannot run locally are run before it reports."
  - "c2: The planner offers only items that can start and that the owner allows, and says why it holds the others."
check: demo a week of CI and eval runs on main with no flaky failure, and a dispatch plan that offers only startable items and names the reason for each one it holds, run by the owner
---

## Notes

Step 1 of 4 toward v0.1.0-rc.2 (HITLD-137), proposed by the chief of staff on the owner's choice to cut by blocker (2026-11-16). The order comes from what each step unblocks; no priority field. Replaces the idea of moving single items up.

On the owner's choice (2026-11-16), the walk-through skill (HITLD-135) moved here from the former step 5 (HITLD-193, dropped), because the dashboard and the held design items need it.

Re-scoped as a v0.1.0-rc.3 milestone (HITLD-400) by the planning pass HITLD-343, on the owner's decision HITLD-359: the met clauses were dropped. They were c1 "A tracker-only pull request merges within minutes, and the planner's start list and dispatch start agree with each other" (HITLD-130, 131, 140 and 153, all done) and c2 "A held design item is settled with the owner one question at a time through the walk-through skill, each answer recorded" (HITLD-135, done). The new c1 and c2 are the proposal's c3 and c4. The check changed with the clauses.
