---
id: HITLD-651
title: The chief of staff guides requests to steer the plan toward dependent decisions and commitments, never a priority
kind: work
state: planned
created: 2026-11-20
project: HITLD-15
needs: [HITLD-572]
constraint_of: [HITLD-405 c2]
---

## Done when

- The chief of staff skill (`skills/chief-of-staff/SKILL.md`) has a short section, "When the owner asks to steer the plan", that says what to do when the owner asks for a priority, a rank or "this first" (the guidance below).
- The prioritization part of the design (part 2, the ordering rule) has a paragraph "How the owner steers" saying the same, marked as built or decided, not built.
- An offline eval scenario for the chief of staff covers the case: the owner asks for an item to come first, and the response routes it to a dependent decision or a goal and writes no rank.
- The skill change passes the offline eval gate, and `hitld work check` passes.

## Why

The owner asked on 2026-11-20 how person preferences, which change over a project's life, enter the orchestrator's and the chief of staff's scheduling and planning without becoming a priority, which the system avoids unless there is a damn good reason; for example, to see one output sooner to decide something. The owner decided (HITLD-650) to encode the way of working in the chief of staff's own instructions, so that any chief of staff session guides the owner the same way, and noted that ranking by wave will be moot once runs go away.

## The guidance the section carries

- **There is no priority field, and the chief of staff does not create one.** Ordering is cost of delay divided by size, with the critical path dominating (design part 2). Do not write a rank, a priority label or a standing order.
- **Ask what the owner is trying to decide or see.** "I want X sooner" almost always means a decision waits on X. Express it as a decision (or a question) that needs X, with a cost-of-delay profile; the ordering rule then pulls X forward, and the pull ends when X is done.
- **If the reason is only taste,** say what it displaces, and use the lightest lever that expires:
  - while runs exist: a scoped start order for the wave, recorded as a decision with its reason, ending when the wave does (HITLD-646 is an example);
  - once runs go away (HITLD-484, HITLD-492): open a commitment, a goal under a budget in a signed decision (HITLD-522), and the planner orders within it. The owner chooses the goal, not a rank.
- **Standing taste** goes in the owner's portfolio shares and value estimates, or in the dated preference record (HITLD-570), which never grants authority.
- **Moving a milestone or a dependency changes what a release means.** It is for that purpose, not for "show me this first".
- **Record each steer** as a decision with its reason and when it ends.

## Notes

A skill change needs the owner's own yes to merge and the eval gate (design rule 7). Related: HITLD-572 (the design update, done), HITLD-570 (the preference record), HITLD-522 (the commitment), HITLD-646 and HITLD-645 (waves ordered by the owner), design part 2 (the ordering rule). Placed under HITLD-405 clause c2 (rc.3.1, the chief of staff's behavior) as a proposal for the owner to move.
