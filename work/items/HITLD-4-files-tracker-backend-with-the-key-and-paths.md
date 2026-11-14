---
id: HITLD-4
title: "Files tracker backend, with the key and paths as settings (piece a)"
kind: work
status: Done
created: 2026-11-14
project: HITLD-2
---

## Why

Agrees with the reference tracker's own scripts byte for byte on a large existing tracker.

## Done when

- The tracker key and the paths come from `tracker.json`, not from the code.
- `hitld work check`, `views` and `claims` run, and schemas refuse unknown keys.
- IDs are allocated by the orchestrator only, from reserved blocks.
- On a large existing tracker in the reference format, the output agrees byte for byte with that tracker's own scripts.
