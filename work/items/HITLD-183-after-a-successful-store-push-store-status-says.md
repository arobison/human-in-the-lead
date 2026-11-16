---
id: HITLD-183
title: After a successful store push, store status says the push is no longer due
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

After a successful `hitld store push` (the remote moved from version 11 to 12 and `store status` showed the local head equal to the pushed head), `hitld store status` still reported `push_due: true` with `push_reason: local-changes` and `local_changed: true`, and it did so on a second reading some minutes later. The store guide says a push rewrites the remote head even with nothing new and prunes older files, so a status that wrongly says a push is due invites a push that is not needed, and hides a real one.

## Done when

- After a successful push, `store status` reports no push due until something is written to the store again.
- The cause is found and recorded in the item: what the status compares, and what writes to the local store after a push (a sync record, a ledger event, a file the comparison counts).
- A test pushes a fixture store and checks that the status reports no push due, then writes an event and checks that it reports one.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the chief of staff in the first self-hosted run and raised under the owner's instruction that problems it meets are checked against the tracker and filed (HITLD-181). Not seen in a clean checkout: the store here has an unrelated history, so the cause may be specific to it, and the first step is to reproduce it in a fixture.
