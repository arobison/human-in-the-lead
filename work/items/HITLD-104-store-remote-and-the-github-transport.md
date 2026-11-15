---
id: HITLD-104
title: "StoreRemote and the GitHub transport: head, fetch, compare and swap, pruning"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

Design 0003 sections 4 and 7: a small `StoreRemote` interface, with a private GitHub repository per project as the first transport (Q3, Q4). Authentication is the session's own git access.

## Done when

- `StoreRemote` has head, fetch, compare-and-swap push and prune; a push behind the remote's head is refused and retried after a pull.
- The GitHub transport uses git over the session's existing access (no new token); one repository per project.
- A conformance test runs the interface against a local bare repository as the fake remote.
- `npm run check`, the offline eval gate and `hitld work check` pass.
