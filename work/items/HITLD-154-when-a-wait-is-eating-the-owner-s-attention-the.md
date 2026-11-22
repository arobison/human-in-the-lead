---
id: HITLD-154
title: When a wait is eating the owner's attention, the system says it is real friction, records it, and changes the plan
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-566 c3]
---

## Why

Design part 2 says the constraint of the system is usually the owner's attention or the merge queue, and that the system keeps the constraint from waiting on anything else. Nothing implements that. In the first self-hosted run, every tracker change waited for a full CI run and then for a merge by hand, and the owner said the wait was eating their attention. The item that would fix it was not started: the planner ranks by how many items an item unblocks, ranked it below two others, refused a start with nothing running, and the one override (`--by-hand`) was denied by the session's permission system. The owner's remedy, a stored `priority`, had been retired on purpose (design Q30), and the queue still sorts on it as a dead tiebreak. The system's only answer was to ask the owner which workaround they preferred, which spent more of the attention that was already short.

## Done when

- A sensor measures the owner's waiting: the time from a pull request being ready to its merge, and the time a decision waits for an answer, per day and per cause. It is shown in the digest and counted against the attention budget when the owner is the one waiting.
- When the owner says in their own words that a delay is costing them attention, the chief of staff records it as a friction event through `hitld rights record`, naming what the wait was about. It never infers annoyance from anyone else's text.
- The response is fixed in the skills, in this order: say plainly that the delay is real friction and name its cause; name what is holding the fix, and whether the holder is a rule, a bug or a permission; propose at least one different route with its cost, as a decision with a recommendation; and, where the route is in the system's own rights (a tracker edit, a reorder the owner already authorized), take it without asking again. It never answers friction with a request for a choice among workarounds it could have narrowed itself.
- The planner honors a recorded direct reorder: a decision the owner records with a reason moves the named item to the head of the queue until it is done, and is the one sanctioned way to put an item ahead. This is the design's "the owner can always reorder directly", recorded as a decision (design 2.4), now with an effect.
- While the owner's waiting is above a threshold, items that relieve the constraint (faster checks, merge automation, answering a held decision) rank ahead of items that do not, and the plan says why.
- The dead read of `priority` in `core/lib/dispatch/queue.mjs` is removed, and the comment that describes the ordering is corrected.
- Tests cover friction recorded from the owner's turn and refused from anywhere else, a reorder moving an item that the unblock count would rank lower, the sensor, and the fixed order of the response. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. It needs HITLD-134 (`rights record`, merged) and relates to HITLD-153 (a start refused with nothing running), HITLD-143 and HITLD-150 (merging without a per-change owner approval), and HITLD-48 (friction signals for maintainers, which counts events per HITLd version and is a different purpose). The attention budget is HITLD-84 (done).

## Returned to proposed on 2026-11-20 (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (493,509,508): friction sensor, attention budget, owner waiting. The decisions since then are stay in the harness and answers by proof (HITLD-540, 515); the pace decisions (HITLD-530, 549, 550); the audit of defaults (HITLD-532 to 538). The owner decided (HITLD-578) that the items the decisions change most return to `proposed` until reshaped, so the planner does not offer them; the owner promotes the item again once it is reshaped.

## Moved on 2026-11-20 (HITLD-602)

On the owner's decision HITLD-602, this item moved from milestone HITLD-189 (c2) to milestone HITLD-566 (c3), where its build belongs with the trust engine (release stage rc.5).
