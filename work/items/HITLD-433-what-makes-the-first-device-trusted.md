---
id: HITLD-433
title: What makes the first device trusted
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. You confirm it by hand: The first device shows a fingerprint; the owner confirms in their own turn; its public key is pinned in the store's header; later devices need a signature from an approved device."
answered_at: 2026-11-16T22:23:28.401Z
answered_via: question-tool
answered_by: owner
---

## Question

With no device approved yet, what makes the first device trusted: the owner's confirmation by hand, trust on first use, or a key the owner holds elsewhere?

HITLD-333: device approvals must be verifiable by signature.

## Options and recommendation

- A. You confirm it by hand: The first device shows a fingerprint; the owner confirms in their own turn; its public key is pinned in the store's header; later devices need a signature from an approved device.
- B. The device that creates the store: Trust on first use.
- C. Your key from elsewhere: Root trust from a key the owner holds.

Recommended: You confirm it by hand. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
