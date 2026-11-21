---
id: HITLD-694
title: The dashboard regenerates on events and says when and where it read its data
kind: work
state: planned
created: 2026-11-21
project: HITLD-15
needs: [HITLD-691]
---

## Why

Decided by the owner (HITLD-689): the page is a static, self-contained file regenerated on events (the event-first cadence, HITLD-536) and on demand, and it says when and where its data was read. No server.

## Done when

- `hitld dashboard` regenerates when the tracker or the ledger changes, through the same event wakes the cadence already uses, and on demand; it does nothing when nothing changed.
- The page states when each part of its data was read and where from (the tracker at a commit and branch, the private store on this machine), and a project's panels and fragments show their own read times.
- A page generated from a container shows that container's store until the stores sync, and says so.
- No server and no network request is introduced; the page stays one self-contained file.
- Tests cover regeneration on a change, no regeneration without one, and the read-time stamps. `npm run check`, the offline eval gate and `hitld work check` pass.
