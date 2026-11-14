---
id: HITLD-9
title: Quotas, the reserve gate and hitld report (piece f)
kind: work
status: Done
created: 2026-11-14
project: HITLD-2
---

## Why

Part of the slice usable in a consuming project.

## Done when

- Quotas are declared in `policy.json` with the owner's reserve, and each has a forecast.
- Near the reserve the orchestrator economizes, and at the reserve it stops autonomous dispatch and tells the owner.
- `hitld report` writes a static HTML report and a text digest, and shows the forecast that triggered a stop.
- The four simulated-quota scenarios pass offline.
