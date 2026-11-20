---
id: HITLD-638
title: Commands and tools that return data check the label against the session's clearance and fail closed (HITLD-620)
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-620]
---

## Done when

- Every HITLD command that returns data, dyno's result commands (through its own check) and a hook on file reads check the label against the effective clearance of the session's model and role before returning anything labeled, and fail closed with a reason that names no value.
- A refused read is recorded in the ledger without the value, so the owner can see it.
- The existing public-text check stays and uses the same check function for the public place.
- Known limits are stated in the guide: a person pasting data into a prompt, and a tool that bypasses these commands.
- An eval scenario covers a session on a model that is not cleared trying to read a labeled result, and a session on a cleared model reading it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Decided in the classification taxonomy walk-through of 2026-11-20 (HITLD-625 to 635, item HITLD-620). The decision to enforce at the commands and tools that return data, since HITLD controls what tools return to a session and not what a harness sends to its model.

## Notes

Related: HITLD-609 (the measurement-tool design), HITLD-616 (executors on other providers and local models). Code, schema and policy changes need the owner's own yes to merge. Needs HITLD-620 (the design parts are updated to the decisions first, as part of done). Placed under HITLD-567 clause c2 (rc.5) as a proposal for the owner to move.
