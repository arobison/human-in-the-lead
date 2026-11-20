---
id: HITLD-598
title: The chief of staff does not message the owner about events that need nothing
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Why

The first retrospective (HITLD-589, finding F12) found that about 57 of 153 chief-of-staff messages right before an owner turn reported no change: subscription confirmations, replayed events and "no change" check-ins. They cost the owner reading time and bury the messages that matter. The owner decided events first with a slow timer as a safety net (HITLD-536).

## What it should do

- Subscription confirmations, replayed events and "no change" check-ins go to the log only. The chief of staff speaks when something changed or the owner must act; a check-in that finds nothing produces no message.
- Measure: the share of chief-of-staff messages that report no change (about 57 of 153 in this run).

## Done when

- The missing information is obtained first (the proposal is from the retrospective, HITLD-589; shape it with the owner), then a failing test or eval that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test, and the design parts it affects are updated in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Skill wording; the owner's own yes to merge. Adopted as a working practice on 2026-11-20 before it is built. Placed under HITLD-405 c3 (notifications and found work handled on time and briefly) by the chief of staff, a proposal for the owner to move. Related: HITLD-536.
