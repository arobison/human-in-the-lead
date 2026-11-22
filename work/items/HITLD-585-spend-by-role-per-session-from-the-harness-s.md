---
id: HITLD-585
title: Spend by role per session, from the harness's session records, on the dashboard
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
constraint_of: [HITLD-192 c3]
---

## Why

The owner asked on 2026-11-20 whether there is a way to see where all the tokens a project spends go, by role (executor, orchestrator, overhead and so on). The ticket for the full view is HITLD-139 (tokens by role and activity, with trends), but it sits in HITLD-408, which is under no release stage. The ledger records tokens per completed dispatch only, so the spend of the chief of staff session, the orchestrator, probes and subagents is not in it. The harness's session record reports usage and cost for any session, and per turn through its result events, which is how executor tokens are already measured (HITLD-438). The first reading of it showed the chief of staff session as the largest single consumer, about 13 times the orchestrator session, which is what made the owner's question about delegation (HITLD-582) answerable. The owner decided (HITLD-584) that a first slice comes in rc.3.

## What it should do

- Read the usage and cost of every session the project started (the chief of staff, the orchestrator, each executor, subagents) from the harness's session records, and record each against a role. Usage the harness does not report is counted as unknown, never guessed (HITLD-139).
- Probe spend (HITLD-169) is its own role, not charged to an item.
- `hitld metrics tokens --by role` and a small panel in the dashboard show the total and the share by role, and each session's share of its role. Trends come with HITLD-139.
- A session's context size is shown beside its spend, since a large context re-read each turn is what made the chief of staff session expensive.

## Done when

- The missing information is obtained first (the shape is settled in HITLD-584; the record format and the role tags are shaped), then a failing test that reproduces the gap: the chief of staff session's spend appears nowhere in the ledger (design part 14.7).
- The command and the panel show the share by role for a fixture project and for this one, and unknown usage is shown as unknown.
- The design parts on token accounting are updated in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The fuller split by activity, area and model, the rework and overhead shares and the trends stay in HITLD-139 under HITLD-408; its note that per-turn usage is not reported is stale. Code and dashboard: the owner's own yes to merge. Placed under HITLD-192 (the owner sees the plan, milestones, what is running, and quota and spend in one page) as a new clause c3 by the chief of staff, a proposal for the owner to move. Related: HITLD-139, HITLD-438, HITLD-509, HITLD-582 and 583 (the curator agent).
