---
id: HITLD-3
title: "Foundation: schemas, CLI, policy loading, fake adapter"
kind: work
status: Done
created: 2026-11-14
project: HITLD-2
---

## Why

Part of the slice usable in a consuming project.

## Done when

- Every schema in `schemas/` carries `schema_version` and refuses unknown keys.
- The `hitld` command table runs, and `hitld --help` lists every command.
- `policy.json` loads through trusted loading: data only, and unknown or code-running keys are refused.
- A fake harness adapter drives the core tests, and no core code calls a harness directly.
- `npm run check` passes.
