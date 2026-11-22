---
id: HITLD-894
title: Store folders and files are created private and store status reports looser modes
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-190 c?]
---

## Why

Store files and folders are created with default modes (`core/lib/store/store.mjs` write and append); only the sync record is 0600. On a shared machine with umask 022 other local users can read the plain ledger, decisions, approvals and private terms.

## Done when

- The store is created 0700 and its files 0600, and `store status` reports looser modes.
- A test creates a store under umask 022 and checks the modes.
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S8 (low) of the second Fable security pass (2026-11-22), decision HITLD-885. rc.3.
