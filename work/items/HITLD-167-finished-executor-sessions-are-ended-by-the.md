---
id: HITLD-167
title: Finished executor sessions are ended by the chief of staff when their work is merged, and the skills say how the orchestrator asks
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-135]
---

## Why

A tier-3 executor in a cloud harness is a session the chief of staff started, in a container of its own. After its work merges or is dropped the session has no further use, and nothing in the skills says who ends it or when. The chief-of-staff skill lists `archive_session` for stopping a tier-3 session, and the `relay:` line of the orchestrator's message has two verbs, `poke` and `stop`, both meant for a running session. In the first self-hosted run the chief of staff archived two finished sessions on its own judgment and invented a third verb, `relay: archive`, to ask for the same from the orchestrator, which was withdrawn the same day. A new orchestrator reading the skills would not know any of this.

## Done when

- The skills, the message shape and design 13 say what the owner decided in a walk-through (HITLD-205 to 209):
  - A finished executor's session is ended when its pull request has merged or been dropped, not when its report arrives, so follow-ups keep the agent's context (HITLD-205).
  - The orchestrator owns spawning and ending executor sessions. Until it has the harness tools, the chief of staff makes the call as its proxy, and the orchestrator stays within the executor cap and the quota gate (HITLD-206).
  - The orchestrator asks with a separate relay verb, `end` (`relay N: end <dispatch>`), distinct from `stop`, which interrupts a running session (HITLD-207, 208). Ending a session that is already ended is a no-op and the confirmation says so.
  - The chief of staff's hourly check-in lists the sessions it started whose items are done on `main`, ends them, and says so in the digest (HITLD-209).
- The chief-of-staff and orchestrate skills, the message shape and design 13 say the chosen answer, in one change the owner approves, and the plugin copies match.
- A test or eval scenario shows an orchestrator reporting a merged item and the chief of staff ending its session once, and not ending one whose pull request is open.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. Settled by the owner in a walk-through on 2026-11-16 (HITLD-205 to 209); state moved from `proposed` to `planned`. Until it is built the working rule is `relay N: stop <dispatch>` when an executor's work is merged or dropped. HITLD-130 removes worktrees of merged branches, which is a different resource.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (508,492): session ending, relay verbs. The decisions since then are the ledger and no-run decisions (HITLD-484 to 490); stay in the harness and answers by proof (HITLD-540, 515). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.

## Restated by the owner on 2026-11-22

The owner told the chief of staff: archive completed sessions when the handoff is complete. The chief of staff now does this by hand: a finished executor session is archived once its pull request has merged, and an orchestrator session once its successor holds the run lease. Eleven executor sessions were archived on 2026-11-22 under this rule. This item should make it a command and a line in the chief-of-staff skill; it stays in the routine-jobs milestone and stays out of the orchestrator's start list until the owner names it.
