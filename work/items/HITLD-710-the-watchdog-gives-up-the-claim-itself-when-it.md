---
id: HITLD-710
title: The watchdog gives up the claim itself when it abandons a dispatch
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-404 c3]
---

## Why

The watchdog's ladder ends in an abandon: the agent is stopped and the item is ready again. If the abandoned branch had claimed the item, the claim keeps the item out of the plan (`not-planned`) until someone gives it up with `hitld work unclaim` (HITLD-194). Today `hitld dispatch watch` only prints that step for the orchestrator to run, and the orchestrate skill tells it to, so an orchestrator that forgets it leaves the item stuck and the refill cannot dispatch it. The unclaim is a commit on main (design 3.4), and a session that cannot push main reaches main only through a pull request.

## Done when

- When the watchdog abandons a dispatch, the claim its branch made is given up as part of the same step, with the reason `abandoned: <why>`, and the result says that it was or that there was none.
- The build says how the unclaim commit reaches main where the session cannot push it (for example through `hitld work publish`), and an item whose unclaim has not reached main is reported as held, never dispatched twice.
- A test covers an abandon with a claim, one without, and one whose unclaim cannot reach main.
- The orchestrate skill drops the manual unclaim step it now gives, and its plugin copy matches.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised in the review of PR 405 (HITLD-194). Proposed because the watchdog is a script with no model that has not written to main before, and because the unclaim's route to main differs by merge path. A rule an executor or orchestrator could forget is enforced by the command, not by skill text (HITLD-537). Related: HITLD-92 (the watchdog), HITLD-346 (releasing a dispatch that will not merge). Code and skill: the owner's own yes to merge.
