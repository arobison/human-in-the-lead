---
id: HITLD-10
title: Offline eval runner and scenarios (piece g)
kind: work
state: done
created: 2026-11-14
project: HITLD-2
---

## Why

Part of the slice usable in a consuming project.

## Done when

- Scenarios have a format, fixtures and graders, and `hitld eval --offline` runs them and prints a pass or fail for each.
- A result records the plugin version and the model.
- A regression gate fails a change that makes a passing scenario fail.
- `hitld eval --offline` passes in CI.
