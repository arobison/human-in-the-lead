---
id: HITLD-123
title: "Tracker IDs never collide across sessions, and an answer applies only to the question it answers"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

Two sessions on different machines each filed a decision from their own copy of main and both took the next free ID. The owner's answer to the second was then applied to the first: a device removal never happened, and the device kept access to the private store until the removal was asked again. The owner decided this is fixed before v0.1.0-rc.1.

## Done when

- **IDs do not collide.** An ID is taken from a source every session shares, not only the local checkout: for example a counter the store remote moves with compare-and-swap, or a check against `origin/main` and the open branches that refuses an ID already in use. Two sessions filing at once get different IDs; a test races two filings.
- **An answer applies only to its question.** `hitld rights answer <ID>` checks that the tracker item, the private ask record and the action it would apply (for a device decision: the action, device name and fingerprint) are the same question; when they differ it refuses with a named code and records nothing.
- **Duplicates are caught.** `hitld work check` and the merge check refuse two tracker items with the same ID, naming both files.
- Design parts 3 (IDs) and 4 (answers) say so.
- `npm run check`, the offline eval gate and `hitld work check` pass.
