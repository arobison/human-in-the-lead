---
id: HITLD-805
title: The design says how an owner decision reaches the orchestrator's permission checks
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-254]
---

## Done when

## Why

HITLD-803 (the owner, 2026-11-22) settles how an owner decision reaches the orchestrator's permission checks: allow rules plus a signed decision check. Design parts 4 (decision rights) and 13 (operations) must say it, and `docs/` changes only through the curator job and a design PR.

## Done when

- Parts 4 and 13 say the chosen answer, the command list as data, how a rule is revoked, and that every use is logged.
- The design PR reaches main only with the owner's own yes. `npm run check` and `hitld work check` pass.

