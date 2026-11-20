---
id: HITLD-186
title: A permission denial is a typed fault that escalates, not a stall
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-135]
---

## Why

In the first self-hosted run a denied action (a force-push, a tool install, a `--by-hand` start, an `add_repo`) stopped the run's progress with no record and no route: the agent could only stop, work around it, or ask in chat. The owner's attention is the scarce resource, so a denial should be a typed fault that names what was denied, what it blocks, and who can lift it, and should escalate by the friction rules (HITLD-154) instead of waiting unseen.

## Done when

- The design says what a denial is (a fault kind), what it records (the action, the item or dispatch it blocks, the options left) and how it escalates.
- Orchestrators and executors report a denial as that fault on their relay line; the chief of staff files or updates a work item and asks the owner one question if it needs a decision.
- A denial is never retried verbatim.

## Notes

Proposed: it is a design choice about faults and escalation, so the owner reviews it with the walk-through skill (HITLD-135). Raised under HITLD-181.

## Moved on 2026-11-20 (HITLD-607)

On the owner's decision HITLD-607, this item moved from milestone HITLD-407 (c2) to milestone HITLD-404 (c4). It still needs a design walk-through (HITLD-135) before it is built, so it is not ready.
