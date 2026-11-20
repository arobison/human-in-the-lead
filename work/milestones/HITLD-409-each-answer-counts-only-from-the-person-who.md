---
id: HITLD-409
title: Each answer counts only from the person who gave it
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-53
outcome: When more than one person leads, every decision answer is signed by the person who gave it, and how a team shares the loops is decided.
done_when:
  - "c1: A decision answer carries a signature made with the person's own key, and an unsigned answer, or one signed by an unknown key, is refused."
  - "c2: The owner has decided how a team of people in the lead shares the loops, and the design says so."
constraints: [HITLD-36 c1, HITLD-44 c2, HITLD-501 c2]
check: demo two people each answer a decision with their own key, and an unsigned answer and one signed by an unknown key are refused, run by someone other than the authors
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-366: HITLD-36 gets its own milestone under HITLD-53 with the decision HITLD-44 (which needs it). The owner commits it later. Stage: after v0.1.0.

## Decided on 2026-11-19 (HITLD-515, HITLD-516)

A decision answer is valid by a checkable proof, not by its channel (HITLD-515). Whose key signs is open until HITLD-333's migration is designed (HITLD-516). How a team shares the loops stays with HITLD-44.

## Moved on 2026-11-20 (HITLD-592)

On the owner's approval of the nine roadmap moves (HITLD-592), this milestone is no longer a need of v0.1.0-rc.5 (HITLD-568) and stays after v0.1.0: the key that signs answers waits on the HITLD-333 migration design (HITLD-516).
