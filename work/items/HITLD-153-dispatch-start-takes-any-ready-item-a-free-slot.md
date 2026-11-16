---
id: HITLD-153
title: dispatch start takes any ready item a free slot allows, and an item whose work awaits merge is not planned again
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-130]
---

## Why

In the first self-hosted run, with nothing running and a cap of 2, `hitld dispatch start HITLD-140 --by-hand` was refused: "HITLD-140 is ready but no slot is free (0 running, cap 2)". Two faults cause this, in `planDispatch` (`core/lib/dispatch/plan.mjs`) and the start command (`core/lib/cli/commands/orchestrator.mjs`).

- **A start is allowed only for an item the plan itself proposes.** `dispatch start <ID>` runs the planner and refuses unless the item is in the plan's start list. The planner fills its start list in priority order up to the cap, so two higher-ranked items fill both slots, and a ready, independent item is refused while the free-slot count is zero because of items that are only proposed. `--by-hand` lifts the setup hold and nothing else.
- **An item whose work is finished but not merged is planned again.** The tracker on main shows an item done only after its pull request merges. Until then the planner lists it as ready, ranks it first and gives it a slot. HITLD-134 held a slot in every plan while its pull request waited, and a repeat dispatch of it would have done the work twice.

## Done when

- `dispatch start <ID>` starts any ready item when running dispatches plus those just started are below the cap and the item is not held, whatever the item's place in the plan. The plan stays advice for what to start next, not the only set of items that may start.
- `--by-hand` starts the named item when a slot is free, and when none is, refuses with the number of slots, who holds them and what would free one, in the same words as the plan.
- A dispatch that has reported and whose branch is not yet merged counts as awaiting merge: the planner does not list its item as ready, does not give it a slot, and shows it with its branch and pull request, so the orchestrator is not told to start it again.
- When the awaited merge happens, or the dispatch is abandoned, the item is planned again as the tracker says.
- Tests cover a ready item started past higher-ranked ones with free slots, a refusal that names the holders when none is free, and an item awaiting merge that is not planned and then is after the merge. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the orchestrator in the chief of staff's run and verified in the code. HITLD-130 changes dispatch plan and start for the disk floor, and HITLD-136 changes the brief and the overlap rule, so build this after them or in one wave with care. It does not block HITLD-109 as written; it joined the milestone Consumer live (HITLD-67) and the first step toward rc.2 (HITLD-189).

Also reported as GitHub issue #151 (bug): The refill after dispatch complete offers the same item again while its finished branch waits to merge, inviting duplicate work.

And as GitHub issue #159 (bug): dispatch start --by-hand is refused as not-planned after setup with both slots free, because the planner filled the slots with its own top picks.

Triage 2026-11-16: both duplicate this item, which covers them; the issues are untouched on GitHub, and the two reports raise this item's reach.
