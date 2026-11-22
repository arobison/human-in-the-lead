---
id: HITLD-734
title: Replace the milestone lists in HITLD-15 and HITLD-28 with pointers to the milestone entities
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

The owner decided (HITLD-733) to replace the written-out milestone lists in the HITLD-15 and HITLD-28 project bodies with pointers. The HITLD-701 curator pass found that the lists had drifted from the milestone entities, which hold the detail. This is a curator pass.

## Done when

- The HITLD-15 and HITLD-28 project bodies name each of their milestones by ID, with one short line saying what it is for, and no longer restate their constraints, items or done-when text.
- Nothing is lost: any statement in a removed list that no milestone entity holds is moved into that entity or noted in the pull request.
- Scope, plan, placement and release of every item are unchanged.
- `hitld work check` passes with no new warnings.
