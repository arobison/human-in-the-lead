---
id: HITLD-805
title: The design says how an owner decision reaches the orchestrator's permission checks
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-254]
constraint_of: [HITLD-67 c?]
---

## Why

HITLD-803 (the owner, 2026-11-22) settles how an owner decision reaches the orchestrator's permission checks: allow rules plus a signed decision check. Design parts 4 (decision rights) and 13 (operations) must say it, and `docs/` changes only through the curator job and a design PR.

## Done when

- Parts 4 and 13 say the chosen answer, the command list as data, how a rule is revoked, and that every use is logged.
- The design PR reaches main only with the owner's own yes. `npm run check` and `hitld work check` pass.

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-972 (2026-11-23).

Moved from rc.3 back into rc.2 at the owner's word (2026-11-25): the owner types an allow in the orchestrator's session for every merge pass (two per pull request: the pass that merges main in, then the pass after checks re-run), and asked why. HITLD-803 already settled the fix; this puts its three pieces (this item, HITLD-804, HITLD-805) in rc.2. Owner-held: a permission and guard surface.
