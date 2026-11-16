---
id: HITLD-148
title: A cloud session starts with the owner's settings and the machine's profile, with nothing carried between sessions by hand
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-142]
---

## Why

The person file and the machine file live in each container's home directory. A cloud container is discarded when its session ends, so every new session in the first self-hosted run started with neither file. The first-run setup had to be answered again, and the chief of staff carried the owner's answers to the orchestrator by hand. The milestone's first clause forbids carrying anything between sessions by hand.

## Done when

- A cloud session in an enrolled environment starts with the owner's person settings (caps, reserve, declared limits, attention budget and quiet hours) read from the private store, so it asks for nothing the owner already answered.
- The machine file is recorded at session start from the probe, as it already is for a cloud VM, and the owner's answers about the machine are kept in the store, not asked again.
- The first-run setup asks only for what is missing, and says what it took from the store.
- When the store cannot be reached at session start, the session runs on the conservative defaults (one executor, the default reserve, no declared limits), says what it could not read and why, and asks nothing the store would have answered once it is reachable. The owner can say in their own message to go on.
- A change to the person file is made only in the owner's own turn, and reaches the store through `hitld store push`. An executor cannot change it.
- Tests cover a fresh container with the store, one without it (the setup runs as today), and a stale copy. `npm run check`, the offline eval gate and `hitld work check` pass.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided two choices in this item:

- **Where the settings live (HITLD-162):** in the private store, synced. The person file travels with the store and any enrolled session reads it at start.
- **When the store cannot be reached (HITLD-163):** conservative defaults, and say so: one executor, the default reserve and no declared limits, as setup-not-done behaves today. The session says what it could not read and why, and the owner can say to go on or fix the store.

## Notes

Raised in the chief of staff session, where each new container needed the same setup carried in a message. HITLD-142 gets the store reachable from an orchestrator; this item puts the person and machine settings in it. HITLD-39 and HITLD-88 (done) built the walk-through this builds on.
