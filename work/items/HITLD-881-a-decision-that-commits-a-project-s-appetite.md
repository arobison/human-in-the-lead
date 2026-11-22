---
id: HITLD-881
title: A decision that commits a project's appetite goes to the owner by rule, and rights ask uses the tracker's default classification
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---

## Why

Reported as GitHub issue 545 (https://github.com/arobison/human-in-the-lead/issues/545). A question asking for the bet on a proposed project went to the system by default because no policy rule matched it; the design says only the owner commits a project's appetite. It reached the owner only after the asker added the owner as addressee and a budget trigger by hand. And `rights ask` gives every question an internal classification by default, which a tracker that allows only public files refuses.

## Done when

- A policy rule sends any decision that commits a project's appetite (the bet on a proposed project and its kin) to the owner, without the asker naming the owner or a budget trigger.
- `rights ask` uses the tracker's default classification instead of one the tracker refuses.
- A test per case above (a bet question with no manual fields; a public-only tracker).
- A rights change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Joins Consumer live (HITLD-67) clause c2 on the owner's word of 2026-11-22 (decision HITLD-878).
