---
id: HITLD-11
title: Orchestrator skill, Claude Code adapter, basic merge queue, packaging (piece h)
kind: work
status: Done
created: 2026-11-14
project: HITLD-2
---

## Why

Part of the slice usable in a consuming project.

## Done when

- The orchestrator skill sizes items into tiers, dispatches up to the cap, refills on completion, and sends follow-ups to the same agent.
- The basic merge queue merges in dependency order, tests a batch once, bisects a failure, and regenerates views on `main`.
- A fresh session resumes from the files with a generated hand-over note.
- The plugin and the marketplace install from a local checkout.
- Offline evals cover each of these.
