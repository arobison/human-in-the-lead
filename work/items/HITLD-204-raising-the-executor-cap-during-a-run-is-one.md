---
id: HITLD-204
title: Raising the executor cap during a run is one command, and the plan names the layer that limits it
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

In the first self-hosted run the owner asked for three executors at once. The cap is the smallest of the person, machine, project and run layers (`core/lib/settings/layers.mjs`, `capEntry`), and the quota gate in economize mode takes one more slot off. Setting person and machine to 4 changed nothing, because the project policy (`execution.max_executors`, default 3) and the run's own scope (3, fixed when the run started) stayed at 3. The chief of staff first told the owner the cap was below 3 without checking, and then the owner chose a change that could not take effect. Nobody could change the run's cap mid-run, and the plan did not say which layer was limiting it.

## Done when

- `hitld dispatch plan` and `hitld config explain` say which layer sets the effective cap and how much economize takes off.
- A command, owner-only, changes the current run's cap without restarting the run, and the change is logged as the owner's setting. It cannot exceed the project policy's ceiling.
- A raise above the project policy's value is refused with a message naming the policy file, since that is a pull request.
- Tests cover a raise within the ceiling, one above it, and the plan's explanation.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Reported by orch-1 and filed by the chief of staff under HITLD-181. Related to HITLD-154 (a delay that eats the owner's attention is named as friction) and HITLD-153 (the planner's start list).
