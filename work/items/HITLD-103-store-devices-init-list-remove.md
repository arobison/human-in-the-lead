---
id: HITLD-103
title: "Store devices: init, list and remove, store-devices.json, refusal for an unenrolled device"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
needs: [HITLD-102]
---

## Why

Design 0003 section 6 and Q7: each machine or cloud environment is a device with its own key pair; enrolment is a commit to `store-devices.json` that reaches main only through the owner's merge; removing a device rotates the project key.

## Done when

- `hitld store device init` makes a key pair, keeps the private key where design 0003 section 9 says (the OS keychain locally; an environment variable in a cloud environment, Q6), and prints the public entry to commit.
- `store-devices.json` (schema'd, public keys only) lists the enrolled devices; `hitld store device list` and `remove` read and change it; removal rotates the project key so a removed device cannot open anything pushed after (milestone c3).
- A push from a device not in main's `store-devices.json` is refused by name.
- `npm run check`, the offline eval gate and `hitld work check` pass.
