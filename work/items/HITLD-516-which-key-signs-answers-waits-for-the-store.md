---
id: HITLD-516
title: Which key signs answers waits for the store migration design
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "C. Not yet: Settle the proof kind now; pick the key when HITLD-333's migration is designed"
answered_at: 2026-11-19T21:16:58.810Z
answered_via: question-tool
answered_by: owner
---

## Question

When answers carry a signature, whose key signs?

HITLD-515 made an answer's validity depend on a checkable proof. A device already has a key and an approval flow (HITLD-333: the first device confirmed by the owner, later ones approved by an approved device); HITLD-409 asks for a per-person key.

## Options and recommendation

- A. The device key, person by enrollment: One mechanism: an enrolled device signs, the person is whoever approved the device
- B. A separate person key: Each person holds one key that signs answers; devices only sync
- C. Not yet: Settle the proof kind now; pick the key when HITLD-333's migration is designed

Recommended: The device key, person by enrollment. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
