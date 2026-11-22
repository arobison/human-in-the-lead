---
id: HITLD-240
title: "Design: a blocking Stop hook so no orchestrator or interactive executor turn ends without sending its message"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-135]
constraint_of: [HITLD-404 c4]
---

## Why

HITLD-144's executor (D-17) tested hooks in a real cloud session (Claude Code 2.1.325): a `PostToolUse` hook of type `mcp_tool` delivered a message to the orchestrator; a command `Stop` hook that returns a block decision stopped the end of the turn and the turn continued; a `Stop` hook of type `mcp_tool` delivered the turn's last message verbatim; and edits to the settings file were picked up mid-session. The owner decided (2026-11-16, HITLD-238) that the watchdog ships first and the hook is a separate item.

## Done when

- The owner decides, in a design walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built:
  - Option 1 (the executor's): a `Stop` hook of type `mcp_tool` that sends the turn's last message to the chief of staff, which needs the chief-of-staff session ID in a per-session settings file written by hitld at run start or resume; the contract bars agents from adding hook keys.
  - Option 2 (the executor's recommendation): a blocking command `Stop` hook plus a `PostToolUse` marker on the send-message tool, in the plugin, gated on the role and on a chief-of-staff session ID recorded at run start or resume, with the watchdog as the fallback. Per the docs (not tested) the harness caps consecutive blocks at 8.
  - Whether the same choice applies to interactive executors (HITLD-147).
- Design parts 13 and 16 say the chosen answer; build items follow.

## Notes

`proposed` because a hook changes what agents' sessions do. From D-17's digest on HITLD-144 (PR #182). The test results are in that item's notes.

## Moved on 2026-11-20 (HITLD-607)

On the owner's decision HITLD-607, this item moved from milestone HITLD-407 (c1) to milestone HITLD-404 (c4). It still needs a design walk-through (HITLD-135) before it is built, so it is not ready.
