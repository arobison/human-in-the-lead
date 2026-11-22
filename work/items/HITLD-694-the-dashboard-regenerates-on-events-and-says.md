---
id: HITLD-694
title: The dashboard rewrites its static bundle with current data on events and says when and where it read its data
kind: work
state: planned
created: 2026-11-21
project: HITLD-15
needs: [HITLD-691, HITLD-729]
constraint_of: [HITLD-67 c4]
---

## Why

Decided by the owner (HITLD-689): the page is regenerated on events (the event-first cadence, HITLD-536) and on demand, and it says when and where its data was read. No server.

Reworded for the shared UI kit (HITLD-721, 725, 727): the page is now the shared React app's committed static bundle (built by HITLD-729) written as one HTML file with the current contract data inlined. Regenerating means writing that file again with fresh data; it never runs a bundler, so users need no tooling. Publishing the file as an artifact for the owner is the chief of staff's viewer, and a live artifact feed is a later item, not this one.

## Done when

- `hitld dashboard` writes the static bundle again, with the current contract data inlined, when the tracker or the ledger changes, through the same event wakes the cadence already uses, and on demand; it does nothing when nothing changed. Regeneration uses the committed bundle and runs no build step.
- The page states when each part of its data was read and where from (the tracker at a commit and branch, the private store on this machine), and a project's panels and fragments show their own read times.
- A page generated from a container shows that container's store until the stores sync, and says so.
- No server and no network request is introduced; the page stays one self-contained HTML file with the app and its data inside.
- Tests cover regeneration on a change, no regeneration without one, the inlined data matching the contract at the time of writing, and the read-time stamps. `npm run check`, the offline eval gate and `hitld work check` pass.
