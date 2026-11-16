---
id: HITLD-406
title: HITLd runs on Windows
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: The owner's Windows machine runs the suite, enrolls a store device and syncs the store as macOS and Linux do.
done_when:
  - "c1: The store lives under `%LOCALAPPDATA%`, and the device key is protected with DPAPI."
  - "c2: The store's git ignores the global ignore and attributes files on every platform."
  - "c3: The suite passes with short-name paths."
constraints: [HITLD-249 c1, HITLD-250 c1, HITLD-251 c2, HITLD-294 c3, HITLD-295 c3]
check: demo the owner's recorded Windows run of `npm test` and of store device init, push and pull
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-363; the owner commits it later. Stage: v0.1.0-rc.4 (HITLD-401); HITLD-250's note puts Windows at v0.1.0, not rc.2.
