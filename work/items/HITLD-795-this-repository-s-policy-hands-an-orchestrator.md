---
id: HITLD-795
title: This repository's policy hands an orchestrator over at 30 percent of its context or 8 completions
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

The owner decided (HITLD-794) that an orchestrator hands over at 30 percent of its context window or 8 completions, measured by the chief of staff. Orch-5 ran to about 600k tokens and about 61 dollars with the default 0.7 share, which nothing enforces. This item sets the values in this repository's policy; the package defaults and the measured check are HITLD-796.

## Done when

- `.human-in-the-lead/policy.json` sets `orchestrator.handover_context_share` to 0.3 and `orchestrator.handover_after_completions` to 8, and `hitld config explain` shows both.
- A policy change reaches main only with the owner's own yes. `npm run check` and `hitld work check` pass.
