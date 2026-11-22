---
id: HITLD-552
title: "Trust engine core: supervision modes with an order, a derived record, re-lock and unlock proposals"
kind: work
state: planned
created: 2026-11-19
project: HITLD-15
---

## Why

The owner decided (HITLD-525 to 529, 547, 548) that one trust engine serves merging, commitment, goal-choosing and escalation fixes: it owns the unlock bar, the re-lock on a miss, the trust record and the owner's unlock proposals, while each process registers its kinds, modes and evidence signals. Design 2.15 records only counts per area today (`core/lib/rights/trust.mjs`).

## What it should do

- Supervision modes with a partial order ("tighter than") and the unlock steps a process allows; a ladder is a chain.
- A kind's mode is the latest signed unlock decision minus any re-lock event; its evidence is derived from ledger events and tracker records on demand (HITLD-529). No separate counter.
- The shared evidence core: the owner's report that a decision was wrong (always a miss), a re-opened or reverted outcome, and aging without objection (HITLD-548). Processes add their own.
- The unlock bar from policy (15 aged merges, 7 days, 8 distinct items for merging, HITLD-478, 521) and an unlock proposal arriving as a decision with the evidence and a sample (HITLD-519). A miss re-locks at once (HITLD-479).
- Trust is per project; another project may be proposed the same unlock, citing the first project's evidence (HITLD-526).

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Built with merging and commitment together (HITLD-528). Related: HITLD-507 (the study), HITLD-472, HITLD-291. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.

## Initial grants (HITLD-576)

On migration the engine records today's standing delegations (tracker-only merges and reversible tracker edits by the chief of staff and orchestrator, HITLD-143 and 218) as the owner's initial grants: kinds already unlocked, each by a decision the owner signs dated at migration and citing the standing rule.

## Moved into rc.2 on 2026-11-22 (HITLD-809)

The owner asked why they are asked to approve every code pull request, and decided that the merging trust engine is built in rc.2. This item is planned and also joins milestone HITLD-67 (second clause); it stays in milestone HITLD-566 too. No kind unlocks until it meets the bar (15 merges aged 7 days from 8 distinct items); skills, hooks, contracts, schemas, guards, public interface and policy never unlock.
