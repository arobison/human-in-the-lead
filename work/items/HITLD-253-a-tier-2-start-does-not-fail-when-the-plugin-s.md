---
id: HITLD-253
title: "A tier-2 start does not fail when the plugin's agents are not installed: the plan says so and degrades"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-235]
constraint_of: [HITLD-189 c2]
---

## Why

`hitld dispatch start` for a tier-2 item prints an Agent call that names the agent type `human-in-the-lead:executor-tier2`. In the first self-hosted run, orch-1 made that call (D-19, HITLD-62) and the session answered `Agent type ... not found (available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup, web-fetch)`, because the plugin's agents are installed only where the plugin is, and this repository is not self-hosted until HITLD-109. The dispatch had been recorded in the ledger before the call failed, so it was closed as blocked, and the item lost a start. The skill says to make the printed call exactly, so the orchestrator rightly did not substitute an agent. The result: every tier-2 item (the plan's "implementation inside a known plan") cannot run in this setup.

## Done when

- `dispatch plan` knows which agent types the harness can start (from the harness's declared capabilities or from a probe) and, when the tier-2 agent is not available, plans the item as tier 3 (an interactive session) or holds it with the reason `agent-not-installed`, never offering a call that will fail.
- A failed agent start is recorded with a reason (`agent-not-found`), the dispatch is closed without counting a refusal against the executor, and the plan says what to do next.
- The orchestrate skill says what an orchestrator does when the agent type is missing (tell the chief of staff; do not substitute another agent type).
- A test covers a plan with the agent unavailable, and a start that fails with the agent not found.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by orch-1 (relay 2026-11-16) and filed under HITLD-181. Related to HITLD-141 (merged: tier 3 does not launch headless where it cannot run) and HITLD-235 (the probe for headless ability, which could probe this too). HITLD-109 (self-hosting) removes the cause for this repository, not for the next one.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (508): agents installed in harness, plan tier. The decisions since then are stay in the harness and answers by proof (HITLD-540, 515). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
