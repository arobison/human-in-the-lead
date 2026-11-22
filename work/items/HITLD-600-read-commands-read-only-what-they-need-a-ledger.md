---
id: HITLD-600
title: "Read commands read only what they need: a ledger cursor, claims from candidate branches, no walk of the store, and a cost budget checked as an eval"
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
constraint_of: [HITLD-192 c4]
---

## Why

GitHub issue 342, from a consumer's dashboard on v0.1.0-rc.1: its board took 8 to 14 seconds per read, and three costs sit in hitld itself. (1) `run status` walks the whole private store, including about 5.5 GB of executor worktrees, so a call takes 2 to 14 seconds, and `precedent match` once failed mid-walk when another worktree's folder vanished. (2) `work claims` and `work query --ready` parse every branch's items: 24 seconds on a copy with 971 branches, most long merged or from other tools. (3) `ledger tail` has no `--since`, so a reader that needs only new events parses the whole ledger, which only grows. The consumer's measurements: 98 branches and 213 events took 10.2 seconds cold; 971 branches and 2,130 events took 48.5 seconds. Every consumer dashboard and every orchestrator turn pays these costs.

## What it should do

- **`run status`** reads its records directly and does not walk the store's worktrees; any walk it does need tolerates folders vanishing. (The run object and its lease are being removed, HITLD-470 and 492, so this becomes whatever replaces `run status`: the same rule applies to it.)
- **Claims and ready lists** read only branches that can hold a claim (for example `hitld/*`, or branches with an unmerged claim commit), cache per branch tip, and say what they skipped.
- **`ledger tail --since <event ID or offset>`**, or a cursor, so readers fold in only new events. With one ledger file per writer (HITLD-489) the cursor is per file.
- **A cost budget** for the read commands, checked as a standing eval at today's size and at ten times.
- One item because the cause is one: read commands scale with the size of the whole store, tracker and ledger, not with what was asked.

## Done when

- The missing information is obtained first (the proposal is from the retrospective, HITLD-589; shape it with the owner), then a failing test or eval that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test, and the design parts it affects are updated in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Reported as GitHub issue 342 (a performance report), filed by the owner through `hitld feedback` from a consumer on v0.1.0-rc.1. The issue stays open until this item is done. Related: HITLD-243 (the git process count fix that took `work claims` from 129 to 3 seconds on Windows), HITLD-130 and 200 (removing merged worktrees, which shrinks the 5.5 GB), HITLD-18 (the read API), HITLD-267, 268 and 510 (more read API fields). Code: the owner's own yes to merge. Placed under HITLD-192 as a new clause c4 by the chief of staff, a proposal for the owner to move.
