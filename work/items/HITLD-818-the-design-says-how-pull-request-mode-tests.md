---
id: HITLD-818
title: The design says how pull-request mode tests approved branches together in a batch
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-814]
---

## Done when

## Why

HITLD-814 is settled by the owner (HITLD-815, 816, 817): the pull-request merge queue tests approved branches together in a batch, lands them as per-branch squash commits with Rebase and merge (falling back to a merge commit, then to one squash), and bisects a failing branch out. Design part 14.2 says the pull-request queue checks one branch at a time; `docs/` changes only through the curator job and a design PR.

## Done when

- Part 14.2 says the batch, how it lands (with the fallbacks), the bisect on failure and that approvals hold for the branches that land.
- The design PR reaches main only with the owner's own yes. `npm run check` and `hitld work check` pass.

