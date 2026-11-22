---
id: HITLD-556
title: "Emergent escalations: detection rules, declaration, a reserved slot, and a fix that may start within a cap"
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
needs: [HITLD-552]
constraint_of: [HITLD-566 c3]
---

## Why

On 2026-11-16 several problems that had to jump the queue were handled by hand, each differently (HITLD-441). The owner decided (HITLD-544 to 546) that rules detect an escalation, the chief of staff declares the rest, and the fix may start without a new yes within a cap.

## What it should do

- A closed list of mechanical conditions raises an escalation automatically: every start blocked by one bad record (HITLD-436), a dispatch holding a slot with no live session (HITLD-314), a finished but unmerged item offered again (HITLD-153), a status contradicting its own conclusion (HITLD-386). The chief of staff declares others with a reason from the same list; the owner is told and can demote it.
- The planner puts escalations first and keeps one slot reserved for them even when the pace line says slow.
- The fix may start in that slot within a small budget per escalation; anything over it, any one-way-door change or any never-unlock kind (HITLD-474) waits for the owner's yes; the owner is told when it starts. Escalation fixes are their own kind in the trust engine. The quota reserve still holds (HITLD-422); an item the owner holds stays held (HITLD-353).

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Needs the trust engine core. The size of the per-escalation budget and of the reserved slot are open in HITLD-441. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
