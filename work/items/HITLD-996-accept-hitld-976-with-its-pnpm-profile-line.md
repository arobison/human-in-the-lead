---
id: HITLD-996
title: Accept HITLD-976 with its pnpm profile line deferred to HITLD-921
kind: decision
state: done
created: 2026-11-24
project: HITLD-15
decider: owner
answer: "A. Accept, move pnpm case to HITLD-921: Queue the branch to merge; HITLD-921's done-when carries the pnpm manifest and lockfile requirement."
answered_at: 2026-11-24T02:55:00.018Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-976 came back partial: its done-when line 2 reads manifest and lockfile names from a pnpm ecosystem profile that HITLD-920 and HITLD-921 have not built. Accept it as is or hold it open?

Code on the branch, 1820 tests green; the executor recommends accepting and moving the pnpm case into HITLD-921's test.

## Options and recommendation

- A. Accept, move pnpm case to HITLD-921: Queue the branch to merge; HITLD-921's done-when carries the pnpm manifest and lockfile requirement.
- B. Hold 976 open until 920 and 921 land: Reopen the item and do not merge until the profile exists.

Recommended: Accept, move pnpm case to HITLD-921. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
