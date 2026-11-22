---
id: HITLD-29
title: "Intake and triage: GitHub Issues and the owner's notes"
kind: work
state: proposed
created: 2026-11-14
project: HITLD-28
constraint_of: [HITLD-68 c1, HITLD-69 c1]
---

## Why

Quarantined triager with schema-validated output; signals; duplicates; Q7.

## Done when

- Issues of one named GitHub repository are pulled (not by webhook), and the owner's notes are taken with `hitld note`. Both become signals.
- The triager runs quarantined. Its output passes schema validation or is refused.
- A duplicate is linked to the existing item, and each signal is classified and routed.
- Auto-fix happens only for a known reporter under a confirmed precedent.
- The twelve triage scenarios pass offline.

## Returned to proposed on 2026-11-20 (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (507): triage routing confidence_floor, auto-fix under precedent = trust ladder in inventory. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556). The owner decided (HITLD-578) that the items the decisions change most return to `proposed` until reshaped, so the planner does not offer them; the owner promotes the item again once it is reshaped.
