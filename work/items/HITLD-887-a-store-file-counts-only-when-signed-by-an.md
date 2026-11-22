---
id: HITLD-887
title: A store file counts only when signed by an approved device, and a history with no common base is refused
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

A store file is sealed to recipients' public keys with plain age encryption, so nothing authenticates the sender (`core/lib/store/sealed.mjs`). A history with no common base is merged, new files are taken and `.jsonl` files are unioned (`core/lib/store/git.mjs` `mergeIncoming`), and any `approved` line enrolls a device key (`core/lib/store/devices.mjs` `approvedDevices`). Anyone who can write the store repository can therefore forge an approval for their own key, empty the private term list and inject ledger, trust and decision lines, with no device key. The reviewer reproduced it: the attacker's key was approved and the active private terms went from 1 to 0. This contradicts design 0003 section 9, row 4 (they cannot write an approval).

## Done when

- Each sealed file, or each approvals line, is signed with an approved device's key, and a merge refuses content whose signer is not in the local approved set.
- A history with no common base is refused once a store already has one; an unsigned head is dropped and the last signed version stays.
- A test reproduces the forgery (a forged approval, a forged term removal, a re-enrolling removed device) and shows each refused.
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S1 (high, reproduced) of the second Fable security pass (2026-11-22), decision HITLD-885. It comes before the rest of the second pass. HITLD-870 (an owner's approval needs proof an executor cannot forge) covers the queue's state, not the store.
