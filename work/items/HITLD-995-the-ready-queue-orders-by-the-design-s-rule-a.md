---
id: HITLD-995
title: The ready queue ranks work by the nearest release it serves, weighs paths by estimated tokens, and puts work that feeds open decisions first, with no priority label and nothing for the owner to set
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
needs: [HITLD-298]
constraint_of: [HITLD-67 c?]
---

## Done when

- `priority` is removed from `orderQueue` (`core/lib/dispatch/queue.mjs`) and from the decision urgency weights (`core/lib/rights/urgency.mjs`); a decision's cost of delay becomes the summed estimate tokens of what it blocks. Tests are updated, and one asserts an item with a stray `priority` key orders the same as one without.
- Each ready item gets a tier: the nearest open release whose `needs` closure holds it, where nearest means the fewest open releases in the release's own chain, then the fewest remaining estimated tokens in its closure, then ID. The closure walks item `needs`, release `needs`, and a milestone's constraints through `constraint_of` (the unblock count today follows item `needs` only, so a constraint of HITLD-67 gets no credit from the rc.2 release item). Tests: three parallel releases share X and the nearest release's single gate Y outranks X; a hotfix and a feature release at the same layer, the one with fewer remaining tokens goes first; an item serving two releases takes the nearer tier and counts both releases once; a cycle terminates; with no open release item the order is today's minus `priority`.
- Paths weigh estimated tokens: every open item on a path weighs its sizing estimate (HITLD-298 enables `estimate_tokens`), not 1, in the queue, the critical path, the milestone graph and the decision urgency. A test covers a heavy two-item chain outranking a light three-item chain.
- Inside a tier the order is: work that feeds open decisions first, an owner decision counting double and a decision that another decision needs counting as informing it (a derived count of open decisions in the item's descendant set); then the longest remaining path; then what it unblocks within the tier; then the count of releases behind it; then the smaller estimate; then ID. A test covers a ready item that feeds two open owner decisions outranking one that feeds none.
- Two proposals in one plan whose touched files overlap at or above `serialize_overlap_share` are not offered together, and the plan says why (today the plan serializes only against running dispatches). A test covers two overlapping proposals.
- The plan and `hitld ready` name the next release and its ready, blocked and awaiting-merge counts, give each item its tier release and sort-key fields, and list ready items outside every release's closure with how long they have waited; when the next release has nothing ready the plan says so and offers the next tier. Tests cover both.
- The quota gate's critical-path-only mode lets through the first tier's items that lie on its longest path, with today's rule as the fallback when no release item is open. A test covers it.
- `hitld work check` lists an item whose only link into a release is a `constraint_of ... c?` link that is not numbered, so a mislinked item is seen. A test covers it.
- No new policy key, milestone field or cost-of-delay profile; design part 2.4 gains a built paragraph on the release-chain ordering, and the orchestrate and chief-of-staff skills say the owner steers by a release's `needs` or an item's `constraint_of`, recorded as a decision, never a rank; a skill eval scenario covers it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The queue today orders by what an item unblocks through item `needs` only, then a retired `priority` key, then the smaller estimate. Milestone entities carry derived constraints, not `needs`, so an item that is a constraint of HITLD-67 gets no credit from the rc.2 release item that needs that milestone. On 2026-11-24 the orchestrator's ready list held eight items for other milestones and two for rc.2. The owner does not want to set priorities, active milestones or cost-of-delay profiles by hand: the system should infer what the next release needs from its own graph. Serves the owner, whose budget goes to the release they are waiting on.

## Notes

rc.2, the whole item, at the owner's word (2026-11-25). Design from an independent read-only advisor, checked by the chief of staff against `core/lib/dispatch/queue.mjs` (the unblock count and the `priority` sort key). Owner-held surfaces: the urgency change is in the rights code and design part 2.4 is the design; both reach main only with the owner's own yes. Needs HITLD-298 (estimate_tokens enabled). The parts that need data the system does not record today are split out: the ledger's dispatch durations and the owner's answer latency, the owner-queue-aware ordering, and the overlap-with-an-open-decision soft hold; they need this item first. Related: HITLD-650 and HITLD-651, HITLD-522, HITLD-978, HITLD-136. The advisor could not confirm the limit of four owner-held pull requests in code (it is a chief-of-staff rule, HITLD-865), so the owner-queue item states it as a setting.
