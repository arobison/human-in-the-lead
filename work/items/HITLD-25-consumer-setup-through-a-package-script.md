---
id: HITLD-25
title: Consumer setup through a package script
kind: work
status: Planned
created: 2026-11-14
project: HITLD-15
milestone: consumer-live
needs: [HITLD-24]
---

## Why

Per design 16.7: the CLI as a dev dependency pinned to a release tag, and an explicit setup script (npm run hitld:setup) running hitld install --ref and the plugin commands. Document it; test it on a fixture consumer.

## Done when

- The CLI is a dev dependency pinned to a release tag.
- `npm run hitld:setup` runs `hitld install --ref` and the plugin commands.
- The steps are documented for a consuming project.
- A test sets up a fixture consumer from a clean clone and `hitld check contract` passes.
