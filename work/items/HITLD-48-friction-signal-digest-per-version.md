---
id: HITLD-48
title: "Friction-signal digest per version"
kind: work
status: Proposed
created: 2026-11-14
project: HITLD-28
needs: [HITLD-47]
---

## Why

Design 18.4, "Implicit friction signals". Some friction shows in what people do rather than what they say: overruled precedent applications, answers rated not worth asking, reversed calls, abandoned dispatches, reports that failed the report shape, rejected merges. Counts of these per HITLd version tell maintainers where HITLd gets in the way, without asking anyone to write it down.

## Done when

- `hitld feedback digest` counts each event kind above per HITLd version, per loop or command, from the ledger and the decision log.
- The digest holds no project content: no titles, paths, words or IDs. A test seeds those into the ledger and checks that none reach the digest.
- It is off unless the consuming project's owner turns it on (policy `feedback.digest`, default off).
- When on, each digest is shown to the person before anything is filed and goes through the same approval and filing as other feedback (HITLD-47). Nothing sends it automatically.

## Plan

docs/design/0001-human-in-the-lead/18-self-improvement.md#implicit-friction-signals-later-milestone
