---
id: HITLD-872
title: The chief of staff's merge delegation is scoped, expires, is recorded as delegated, and needs an independent reviewer
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

Decision HITLD-855 let the chief of staff approve merge-queue pull requests on its own through rc.2. The operating-model review found the gate no longer binds: the owner mostly took the chief of staff's recommended option, within minutes, and delegated approvals carry the owner's own sign-off. The owner chose to scope the delegation and add an independent reviewer (decision HITLD-865).

## Done when

- HITLD-855's delegation is rewritten as a scoped unlock: named areas, an end date set by the owner, and never guard, policy, rights, skill or design-rule changes.
- A delegated code merge needs an independent read-only reviewer's verdict (a different agent from the one that built it) recorded with the approval; without one the chief of staff stops and asks.
- Delegated approvals are recorded as `approved_by: chief-of-staff` with a `Delegated-by` trailer on the squash commit, not the owner's `Signed-off-by`.
- The chief-of-staff skill states all of the above, and a digest line reports the share of owner answers that took the recommended option in under a minute.
- A skill or rights change reaches main only with the owner's own yes. `hitld work check` passes.

## Notes

Operating-model review O1; decision HITLD-865. Until this lands, the chief of staff applies the scoped rule by hand: it asks the owner for guard, policy, rights and skill changes and stops for an independent read of any delegated code merge.

## Built on the review skill (2026-11-22)

The independent reviewer's read is the review skill's independent-read brief (HITLD-930); the owner chose to build review into the system (HITLD-929).
