---
id: HITLD-167
title: Finished executor sessions are ended by the chief of staff when their work is merged, and the skills say how the orchestrator asks
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

A tier-3 executor in a cloud harness is a session the chief of staff started, in a container of its own. After its work merges or is dropped the session has no further use, and nothing in the skills says who ends it or when. The chief-of-staff skill lists `archive_session` for stopping a tier-3 session, and the `relay:` line of the orchestrator's message has two verbs, `poke` and `stop`, both meant for a running session. In the first self-hosted run the chief of staff archived two finished sessions on its own judgment and invented a third verb, `relay: archive`, to ask for the same from the orchestrator, which was withdrawn the same day. A new orchestrator reading the skills would not know any of this.

## Done when

- The owner decides, in a design walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built:
  - When a finished executor session is ended: when its report arrives, or when its pull request has merged or been dropped. Design 5.2 says follow-ups go to the same agent with its context intact, so ending it at the report loses the context a rebuild or a review fix needs.
  - Who ends it: the chief of staff, as the skill's table says, or the orchestrator.
  - How the orchestrator asks: the existing `stop` verb, or a new one, and what the chief of staff does when a session is already ended.
  - Whether anything ends sessions the orchestrator forgot, such as a sweep of sessions the chief of staff started whose items are done on `main`.
- The chief-of-staff and orchestrate skills, the message shape and design 13 say the chosen answer, in one change the owner approves, and the plugin copies match.
- A test or eval scenario shows an orchestrator reporting a merged item and the chief of staff ending its session once, and not ending one whose pull request is open.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. State is `proposed` on the owner's instruction, so the design is reviewed with them first. Until then the working rule is `relay: stop <dispatch>` when an executor's work is merged or dropped. HITLD-130 removes worktrees of merged branches, which is a different resource.

