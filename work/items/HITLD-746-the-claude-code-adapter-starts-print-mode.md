---
id: HITLD-746
title: The Claude Code adapter starts print-mode executors detached from the orchestrator
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
---

## Why

The owner decided (HITLD-738, answer B, overriding the recommendation to wait first) that the Claude Code adapter starts each print-mode executor as a separate process that survives the orchestrator, so the orchestrator can end its turn at once. This is the fix for GitHub issue 455 (executors killed when a print-mode orchestrator ends its turn). The build is security-sensitive (detaching, output capture, cleanup, a quota pause that must still reach the executor, and how the watchdog and the next session find an executor nothing waits for), so it stays proposed and is designed with the owner before it is built. HITLD-737 (the watchdog notices at once when an orchestrator exits) is built regardless.

## Done when

- A design, walked through with the owner, states how the adapter starts and tracks a detached executor, how its output and report reach the ledger and its branch, how the quota pause reaches it, and how it is cleaned up.
- A print-mode executor started by the adapter survives the orchestrator ending its turn, and a test or offline eval scenario shows it finishing and reporting after the orchestrator has exited.
- An executor nothing waits for is found by the watchdog and by the next orchestrator session.
- `npm run check`, the offline eval gate and `hitld work check` pass.
