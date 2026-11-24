---
id: HITLD-995
title: "The ready queue orders by the design's rule: a milestone's cost of delay for its constraints, value of information for studies and spikes, and a limit on active milestones, so work for the next release comes first without a priority label"
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Done when

- The queue orders ready items by cost of delay divided by size, with the critical path dominating, as design part 2.4 says: an item that is a constraint of a milestone carries that milestone's cost of delay, and a contribution carries its own value times confidence while it is inside the milestone's scope; a test covers a constraint of a high-cost milestone outranking a smaller, cheaper item of a low-cost one.
- A study or spike whose verdict would change a choice carries its value of information in the order, so a cheap experiment can rank ahead of an expensive build when the choice is uncertain; a test covers it.
- `prioritization.active_milestones_max` exists in `policy.json`: ready items whose only milestones are not among the active ones are offered after those that are, or held with the reason, and the planner says which; a test covers a limit of one with two milestones open.
- A milestone carries a cost-of-delay profile (standard, urgent, fixed-date or intangible, per design part 2.3) that the owner sets as a decision, and a milestone without one ranks as standard and is listed by `hitld work check` or the planner as unset; a test covers both.
- The quota gate's critical-path-only mode lets through the items the same ordering puts first, so a run near the reserve spends on the active milestone's constraints first; a test covers it.
- The orchestrate skill and the chief-of-staff skill say that the queue now carries the next release's work first and that the owner steers with a milestone's cost of delay or an active-milestone choice, never with a priority label; a skill eval scenario covers it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The queue today orders by the critical path, then the priority field, then the smaller estimate, then ID, and its own header says cost of delay and value of information are not built. So the orchestrator offers items for any milestone by how much they unblock and how small they are, not by what the next release needs: on 2026-11-24 its ready list held eight items for other milestones and two for the rc.2 release. The owner expects the system to work on the next release and what unblocks it or teaches us something, by default and without a priority label; the design says that is the ordering rule's job. Serves the owner, whose budget goes to the milestone they are waiting on.

## Notes

rc.3. Depends on an owner decision: HITLD-67 and the other open milestones carry no cost-of-delay profile today, so the rule has nothing to rank them by until the owner sets one for each (a decision per milestone, or one decision that sets them all); the chief of staff puts it to the owner when this item is started. Design: part 2.4, the ordering rule and its milestone and value-of-information adjustments; part 3, milestones and the cost-of-delay profiles; the design leaves how a milestone's scope relates to a budget undecided, so settle it, or take its simplest reading, in the first slice. Related: HITLD-650 and HITLD-651 (the owner's steering without a priority label, and the scoped start order used while runs exist), HITLD-522 (the commitment that orders within a goal once runs go away), HITLD-978 (the planner's ready count). Until this is built the owner steers by a scoped start line to the orchestrator, recorded as a decision. From the owner's question of 2026-11-24 why the planner does not default to the next release.
