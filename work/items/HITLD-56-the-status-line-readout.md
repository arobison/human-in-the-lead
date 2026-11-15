---
id: HITLD-56
title: The status-line readout
kind: work
state: planned
created: 2026-11-14
project: HITLD-28
needs: [HITLD-37, HITLD-40]
---

## Why

Design 12.1.1: one always-visible line that shows what the person would otherwise ask about. The first-run walk-through offers the usage capture; this item is the readout itself.

## Done when

- One line shows, in this order: decisions waiting (with the oldest's age), branches waiting for merge, problems, quota headroom against the reserve, the fleet, machine state, context filling, quiet hours, time since the last report.
- It is computed from the run-state file and the machine registry only, with no network call.
- By default it shows only what needs the person. A person-file setting says how much more.
- A test per row builds a fixture state and checks the line, and a state with nothing to show gives a short line.
