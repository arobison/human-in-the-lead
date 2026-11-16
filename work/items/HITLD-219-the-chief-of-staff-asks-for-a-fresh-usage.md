---
id: HITLD-219
title: The chief of staff asks for a fresh usage figure on a schedule and says what the figure includes
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-165]
---

## Why

Quota is read from a figure the owner declares until the probe exists (HITLD-165). In the first self-hosted run the chief of staff asked for the figure at irregular times, and twice blamed a rate on the executors when the figure is account-wide and includes the owner's other sessions. The gate's forecast is only as good as the latest figure.

## Done when

- The chief-of-staff skill says it asks the owner for the weekly figure at session start, when the forecast's reserve date is within a day, and at a fixed interval while the figure is the only source; it relays the figure to the orchestrator for the gate (HITLD-149 will make that automatic).
- The skill says to state what a rate includes: the figure is account-wide, so a rise is not the executors' unless the ledger's per-dispatch counts (HITLD-139) say so.
- It reports the forecast in one line: reserve date and range, and the gate's mode.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The owner's correction, 2026-11-16: usage includes their other sessions. Related to HITLD-149, HITLD-164, HITLD-165 and HITLD-139. Filed under HITLD-181.
