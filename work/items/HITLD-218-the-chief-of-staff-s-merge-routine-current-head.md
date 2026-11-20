---
id: HITLD-218
title: "The chief of staff's merge routine: current head, required checks, trailers, unsubscribe, end the session"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-167]
---

## Why

Merging a pull request has several steps that the chief of staff did by hand and sometimes got wrong in the first self-hosted run: waiting on stale wake events that named an old head, reading checks of one head and merging another, writing the squash trailers from memory, forgetting to unsubscribe, and keeping a finished executor's session open. The routine should be written down once.

## Done when

- The chief-of-staff skill has one merge routine: read the pull request's current head; wait until every required check is green on that head (a wake that names another head is stale and is ignored); pass the head to the merge as the expected head; use the squash trailers (`Work-Item`, `Dispatch`, `Agent-Role`, the co-author and session lines, and the owner's delegated sign-off only on a tracker-only pull request or after the owner's own yes); unsubscribe from the pull request; end the executor's session once the work is merged (HITLD-167); and tell the owner in one line.
- A code pull request, or one on a sensitive path (`.github/workflows`, the contract, the skills), is merged only after the owner's own answer, never on a relayed approval.
- A test or eval scenario shows a stale-head wake ignored and a merge refused when the head moved.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Builds on HITLD-150 (merge authority on the pull-request path), HITLD-167 (ending sessions) and HITLD-182 (reading notifications between tool calls). Filed under HITLD-181.

## Rewritten on 2026-11-20 (reconciliation, HITLD-576)

Under the one trust engine (HITLD-507, 552) this item is the registration of a kind that the owner has already unlocked by standing rule: today's delegation is recorded as the owner's initial grant, a decision the owner signs dated at migration and citing the standing rule, with the same evidence and re-lock as any kind. It is not a separate rights mechanism.
