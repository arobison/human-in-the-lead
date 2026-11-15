---
id: HITLD-102
title: "Store format 2: age-compatible encryption to several recipients, with test vectors"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

Design 0003 sections 5 and 10: the store bundle is encrypted to every enrolled device, in the age format, with Node's built-in crypto (Q5). Format 1 (one passphrase) stays readable for import.

## Done when

- Format 2 encrypts a bundle to one or more X25519 recipients in the age format (header, stanzas, HMAC, payload), using only `node:crypto`.
- It passes age's published test vectors, and a file it writes opens with the `age` program and the reverse, where the program is installed (the test is skipped, and says so, where it is not).
- Format 1 files still import; nothing writes format 1.
- `npm run check`, the offline eval gate and `hitld work check` pass.
