---
id: HITLD-908
title: A direct edit of the store's settings file is checked at push time, so an executor cannot change an owner setting that way
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-190 c?]
---

## Why

The 'As built' section of HITLD-148 says a direct edit of the store's settings file is carried by the owner's next push and that a check at push time is a follow-up; no item covered it, so 'an executor cannot change the owner's settings' holds only for the command.

## Done when

- A push-time check refuses a settings change made by a direct edit of the store's file by an executor.
- A test edits the file directly and shows the push refused. A store or rights change reaches main only with the owner's own yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable audit finding 3 (2026-11-22); decision HITLD-897. rc.3 by the owner's decision.
