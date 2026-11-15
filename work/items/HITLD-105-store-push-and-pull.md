---
id: HITLD-105
title: "Store push and pull: push, pull, status, remote set and show, merge on pull"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
needs: [HITLD-102, HITLD-104]
---

## Why

Design 0003 section 8: `hitld` moves the encrypted store; the model never does.

## Done when

- `hitld store push`, `pull`, `status`, `remote set` and `remote show`; pull merges the incoming store as `store import` does; machine-local paths never leave the machine.
- The storage holds no plain text of the store, checked by a test that scans the fake remote (milestone c4).
- Every command is refused to executors.
- `npm run check`, the offline eval gate and `hitld work check` pass.
