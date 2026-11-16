---
id: HITLD-188
title: The hand-over note survives the session that wrote it
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

A chief-of-staff session ends with a hand-over note that the next session needs (the state of the run, standing owner rules, lessons). If the note lives only in a session, a file in a container or a chat message, it is lost with the container. The first self-hosted run began from a note written by hand.

## Done when

- The chief-of-staff skill says where the hand-over note is written (a committed or store-synced file, not a scratch path) and when (at each checkpoint, not only at the end).
- A new chief-of-staff session reads it first, and says so if it is missing or stale.
- A test or eval case covers writing it and reading it back in a fresh checkout.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised under HITLD-181. Related to HITLD-142 (nothing travels between sessions by hand) and HITLD-155.
