---
id: HITLD-112
title: "Learned state: every learned parameter with its bound, uncertainty and history, for agents, the dashboard and hitld metrics"
kind: work
state: proposed
created: 2026-11-15
project: HITLD-15
constraint_of: [HITLD-408 c2]
---

## Why

HITLd learns from its own records: calibration of estimates and yield by model and tier, precedent match accuracy and overrules, trust per area (escalation worth, rubber-stamp rate), stall rates, flake measures, quota forecasts, the attention budget, cadence thresholds, and later the controllers inside the owner's bounds (design part 11). None of it can be inspected in one place, with how sure it is and how it got there. Agents should read it before they size or route work, and the owner should see what changed without reading every number. The owner asked for this after v0.1.0-rc.1.

## Done when

- The versioned metrics data contract (`hitld dashboard --json`) has a `learned` section: each parameter with the owner's bound, its current value, its uncertainty (sample size and an interval), its last change and the ledger events behind it, and its history, derived from the ledger, never stored by hand.
- `dashboard.html` has a small panel listing only what changed since the owner last looked, what is drifting, and what rests on too few samples to trust, each with a one-line reason.
- `hitld metrics [--area <a>] [--json]` (the planned command) shows the full table and histories; the orchestrate skill reads calibration from it before sizing.
- Design parts 11 and 12 describe the section, the panel and the command.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Not a release need of v0.1.0-rc.1. Shape proposed in the main session: one data model, three views (the JSON for agents and project dashboards, a short panel for the owner, the command for depth).
