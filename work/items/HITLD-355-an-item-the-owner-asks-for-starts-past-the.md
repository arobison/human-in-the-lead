---
id: HITLD-355
title: An item the owner asks for starts past the usage gate with its cost shown, and the owner can work live in an executor session
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-567 c1]
---

## Done when




- **Owner pull skips the usage gate.** `hitld dispatch start <ID> --by-hand` starts the named item even when the quota gate holds it (critical path only, or stop), for that item alone. Caps, overlap, disk, serial resources and the first-run setup still apply. The start prints the planner's estimate of the tokens, and says plainly if used plus the estimate would reach the reserve and by how much; the estimate is labeled as uncertain. The ledger records that the owner asked, with the owner's decision ID. A hand-started item holds no slot once its work awaits merge, as for any item (HITLD-153).
- **How the owner asks.** The orchestrate skill says the chief of staff relays the owner's own request to the orchestrator as "start <ID> by hand" and records it as the owner's decision; no `needs` edge, no priority field on the item, and no work by the chief of staff itself.
- **Live work with an executor.** When the owner wants to work back and forth on an item (UX tweaks, a design in progress), the orchestrator starts it as an interactive tier-3 dispatch and the chief of staff gives the owner its session link; the owner talks to the executor directly. It is a tracked dispatch (claim, branch, trailers, report, merge queue); the executor still reports to the orchestrator, and nothing merges without the owner's yes where the rules say so. The skill and design 12 say when to use which of the three paths: the queue, an owner pull, or live work.
- Tests cover a quota-held item started by hand (and refused without `--by-hand`), the reserve warning, the ledger record, and that caps and overlap still refuse a hand-started item. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner asked on 2026-11-16 what the right workflow is when they are working with the chief of staff directly and want an item pulled up now: make everything else depend on it, bypass the queue, or something else. The answer in the owner's decisions HITLD-355 and HITLD-356: `needs` edges were a workaround for a planner fault fixed in HITLD-153; `--by-hand` already starts any item the owner asks for but is refused by the usage gate, so the owner could not pull up a non-critical item while the gate held it; and fast back-and-forth work (HITLD-315) should not go through a relay.

## Notes

Code, skill and policy: needs the owner's own yes to merge. Related: HITLD-353 (an owner hold switch), HITLD-315 (executors' test cadence), HITLD-346 (releasing a branch). The decisions are HITLD-356 (the gate) and HITLD-357 (live work).

## Returned to proposed on 2026-11-20 (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (509): owner pull skips usage gate. The decisions since then are the pace decisions (HITLD-530, 549, 550). The owner decided (HITLD-578) that the items the decisions change most return to `proposed` until reshaped, so the planner does not offer them; the owner promotes the item again once it is reshaped.

## Moved on 2026-11-20 (HITLD-602)

On the owner's decision HITLD-602, this item moved from milestone HITLD-189 (c2) to milestone HITLD-567 (c1), where its build belongs with pacing work to the plan (release stage rc.5).
