---
id: HITLD-333
title: Device approvals are authenticated: signed by an enrolled device, with a migration
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Design 3, sections 6 and 9 and the threat model describe how a device is approved and what that protects. An independent review found that the approval record is not itself authenticated: the design and the code differ on who can write it. The details are kept out of this public item and are in a private security advisory. The owner decided (2026-11-16) to track it with a private advisory and this generic item.

This is a one-way door: making approvals verifiable changes the store format, needs a migration for stores that already exist, and has to handle the first device and key rotation. It needs a walk-through with the owner before any build.

## Done when

- The design's threat model and sections 6 and 9 say accurately what each party can and cannot do, before and after the fix.
- Approvals (and enrollment of a device) are verifiable: a device accepts an approval only when it carries a signature from a device already approved, with a defined first-device step and key rotation, and a pull refuses an approval that does not verify.
- Existing stores migrate without losing history, and a device that cannot read the new format says so.
- A test shows that an approval not signed by an approved device is refused.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Design choices are the owner's: the first step is a walk-through, one question at a time. Interim handling is discussed privately with the owner.

## Decided so far

- **The first device (the owner, 2026-11-16, decision HITLD-433):** the owner confirms the first device by hand: it shows a fingerprint, the owner confirms in their own turn, and its public key is pinned in the store's header. Every later device needs a signature from an already-approved device.
- Still to decide, one at a time: key rotation, how existing stores migrate, and what a device that cannot read the new format does.
