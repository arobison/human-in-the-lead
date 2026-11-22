---
id: HITLD-204
title: The executor count is a ceiling the owner can raise with one command, and the plan names what limits it
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

In the first self-hosted run the owner asked for three executors at once. The cap is the smallest of the person, machine, project and run layers (`core/lib/settings/layers.mjs`, `capEntry`), and the quota gate in economize mode takes one more slot off. Setting person and machine to 4 changed nothing, because the project policy (`execution.max_executors`, default 3) and the run's own scope (3, fixed when the run started) stayed at 3. The chief of staff first told the owner the cap was below 3 without checking, and then the owner chose a change that could not take effect. Nobody could change the run's cap mid-run, and the plan did not say which layer was limiting it.

## Settled by the owner

The executor cap is an account-level knob, so a person setting; the project policy does not set it (the owner, 2026-11-16, recorded as HITLD-230). The layers that remain are the person file, the machine file (a hardware limit) and the run. PR #178 put `execution.max_executors` = 4 into this repository's policy.json before this was settled; it stays until the code below stops reading the project layer, because the project default of 3 would otherwise cap the cap.

## Done when

- `hitld dispatch plan` and `hitld config explain` say which layer sets the effective cap and how much economize takes off.
- The project policy layer no longer sets `max_executors`: the code stops reading it for the cap, the schema and design part 5.2 say it is a person setting, and the repository's policy.json value from PR #178 is removed in the same change.
- A command, owner-only, changes the current run's cap without restarting the run, and the change is logged as the owner's setting. It cannot exceed the machine's declared limit.
- A raise above the machine's limit is refused with a message naming the machine file.
- Tests cover a raise within the limit, one above it, and the plan's explanation.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Reported by orch-1 and filed by the chief of staff under HITLD-181. Related to HITLD-154 (a delay that eats the owner's attention is named as friction) and HITLD-153 (the planner's start list).

## Rewritten on 2026-11-19 (reconciliation, HITLD-573)

There is no run layer in the cap any more. `max_executors` is a hard ceiling the owner sets; the count follows measured headroom, the project's pace and the merge queue (HITLD-534, 558, 559). The plan names which of these limits it. One command raises the ceiling.

## Moved into rc.2 on 2026-11-22

The run layer is still in the code: orch-6's run record fixed the cap at 2 while the owner's person and project settings said 4 and 5, and the owner could not raise it without typing in the orchestrator's session. The item joins milestone HITLD-67 (second clause); with HITLD-804 the raise is one owner decision and no visit to the orchestrator.

