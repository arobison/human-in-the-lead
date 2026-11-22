---
id: HITLD-441
title: Design a formal way to handle emergent escalations and prioritize them ahead of planned work
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-566 c3]
---

## Done when




- The owner decides, in a walk-through one question at a time, how the system handles an **emergent escalation**: a problem found while the run is going that blocks, distorts or endangers the rest of the work and so must be dealt with before planned work. The walk-through settles at least: what counts as one and in what classes (for example: corrupts the run's own data or estimates; blocks every start; breaks a safety rule or the owner's money or accounts; blocks one item only); who may raise one (the chief of staff, the orchestrator, an executor through `found`) and how it is recorded (one first-class marker on an item, not a `needs` edge on every other item); how it is prioritized against planned work, the usage gate, the caps and the owner's hold (HITLD-353) and owner pull (HITLD-355); who decides its priority (the system within a rule, or the owner) and how that choice is recorded; and when it is closed.
- The answers are written into the design (parts 2 and 12 and the decision rights), and the items that build them are filed from the walk-through, each placed under a milestone.
- A deferral is a recorded state with its resume trigger: an item or the whole plan can be moved to "the next run" (a new orchestrator starting a new run), "after the window reset" or another named trigger once, shown on the dashboard, and resumed at the trigger without asking the owner again. The owner said on 2026-11-17 that managing this by asking them is the wrong way (the closed gate already decides it, and the question came back every hour; decision HITLD-469).
- The design says what happens to the workarounds used on 2026-11-16 (a `needs` edge per held item, the orchestrator idling by instruction, the owner lowering the critical threshold in the orchestrator's session) once the formal path exists.
- `hitld work check` passes.

## Why

On 2026-11-16 several problems that had to jump the queue were handled by hand, each differently: a wrong token record inflated every cost estimate and held all new starts (HITLD-436, followed by HITLD-438 and 439, which the owner ordered ahead of all other work); the scheduler offered a finished-but-unmerged item and took its slot (HITLD-153); a refused follow-up left phantom dispatches that held both slots (HITLD-314); a stale check-run status made the merge rule ambiguous (HITLD-386); and the owner's holds on large items needed one `needs` edge per held item (HITLD-353, 354). The planner ranks by how much an item unblocks and has no first-class notion of an urgent problem, so each case was settled in conversation. The owner asked on 2026-11-16 for a ticket to design a formal way to handle these emergent escalations and prioritize them.

## Notes

Design-heavy: stays proposed and is walked through with the owner. Related: HITLD-353 (the owner hold), HITLD-355 (an owner's request past the usage gate), HITLD-387 (the chief of staff files investigations itself), HITLD-239 (repeated orchestrator silence), HITLD-154 (a wait eating the owner's attention), HITLD-153 (the planner). Placed under HITLD-189 c2 (the planner offers only items that can start and that the owner allows).

## Decided on 2026-11-19 (HITLD-544, 545, 546)

- **It joins the designs settled before any release item is built (HITLD-544).**
- **Who escalates (HITLD-545):** a closed list of mechanical conditions the system detects itself raises an escalation automatically; the first entries come from the incidents of 2026-11-16: every start blocked by one bad record (HITLD-436), a dispatch holding a slot with no live session (HITLD-314), an item that is finished but unmerged being offered again (HITLD-153), and a status contradicting its own conclusion (HITLD-386). For anything else the chief of staff declares an escalation with a reason from the same list. The owner is told and can demote it. The planner puts escalations first and keeps one slot reserved for them even when the pace line says slow.
- **Who may fix one (HITLD-546):** the fix for a declared escalation may start at once in the reserved slot, within a small budget per escalation. Anything over that budget, any one-way-door change, or anything on a never-unlock kind (HITLD-474) still waits for the owner's yes. The owner is told when it starts. Escalation fixes are their own kind in the trust engine (HITLD-507), so the standing can grow or shrink on evidence.
- **The quota gate still holds:** an escalation does not pass the reserve (HITLD-422); under critical-path-only mode it counts as critical path.

## Still to decide

The size of the per-escalation budget and of the reserved slot. An item the owner holds stays held even if an escalation would otherwise pick it up (HITLD-353, HITLD-504).

## Moved on 2026-11-20 (HITLD-602)

On the owner's decision HITLD-602, this item moved from milestone HITLD-189 (c2) to milestone HITLD-566 (c3), where its build belongs with the trust engine (release stage rc.5).
