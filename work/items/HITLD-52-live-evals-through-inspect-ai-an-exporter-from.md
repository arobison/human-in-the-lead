---
id: HITLD-52
title: "Live evals through Inspect AI: an exporter from our scenarios, OpenTelemetry GenAI traces"
kind: work
state: planned
created: 2026-11-14
project: HITLD-28
---

## Why

Q8: offline scenarios stay with our runner; live, model-dependent scenarios run in Inspect AI for sandboxing, multi-model runs and its viewer, without making it a dependency of the core.

## Done when

- `hitld eval export --inspect` writes live scenarios as an Inspect task set (dataset, solver hooks for the harness adapter, scorers mapped from our graders); results import back as our eval-result records.
- Live-run traces carry OpenTelemetry GenAI semantic-convention fields (model, token usage, tool calls).
- Documented in part 17; Inspect is never imported by the core.


