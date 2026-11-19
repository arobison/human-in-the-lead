---
id: HITLD-145
title: Executors declare where they run, and the machine cap and heavy-work gates apply only to executors that share a machine
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-204]
---

## Why

The effective executor cap is the smallest of the person's, the machine's, the project's and the run's (design 13.4), and the machine's cap counts executors on that machine. In a cloud harness, an interactive tier-3 executor is a session with its own container, so it uses none of the orchestrator's machine. A headless executor, by contrast, is a background process on the orchestrator's machine and does share it. Nothing in the settings or the planner tells these apart, so the machine cap and the load and memory gates measure the orchestrator's machine for executors that run elsewhere. The cap that actually binds an executor in its own container is the plan quota, which spans them all.

## Done when

- A dispatch records where its executor runs: the orchestrator's machine, its own container, or another environment. The harness adapter sets it from the mode the executor was started in.
- The machine cap, and the load, memory, port and lock checks of the environment manager, count only executors that share the machine they measure. An executor in its own container is counted against the person's cap, the project's cap, the run's cap and the quotas, and not against the orchestrator's machine.
- Heavy work an executor runs in its own container is admitted by that container's own load and memory, read where the executor runs, never by the orchestrator's machine (the owner's decision, HITLD-426: read the container's load, not recorded as unchecked). The executor contract has the executor report its container's load and memory before heavy work, the ledger records what it reported, and the gate uses it; where the executor cannot report, the work is recorded as unchecked with the reason.
- `hitld dispatch plan` says, for each held or limited item, which cap or quota decided, so an owner can tell a plan-quota limit from a hardware one. `hitld config explain` shows the same.
- The machine file and design 13.4 say what the machine cap means in each placement. The orchestrate skill's first-run setup stops proposing a machine executor cap from a cloud VM's core count when executors do not run on it.
- Tests cover a headless executor on the orchestrator's machine, an interactive one in its own container, and a mix of both under a machine cap. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. It sits beside HITLD-41 (resource capacities) and HITLD-71 (load-aware dispatch), which assume the work runs on the machine the gate measures, and HITLD-126 (the chief of staff driving other environments). The plan quota stays the cap that spans every placement.

## Note on 2026-11-19

The owner decided (HITLD-534) that the machine cap and heavy-work gates apply only where executors share a machine, and that `max_executors` becomes a ceiling; see HITLD-559.
