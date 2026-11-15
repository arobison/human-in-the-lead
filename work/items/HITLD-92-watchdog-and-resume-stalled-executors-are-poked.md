---
id: HITLD-92
title: "Watchdog and resume: stalled executors are poked and continued, paused runs wake when limits reset"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-92
---

## Why

Agents occasionally hang without reporting, and runs stop when a usage limit or budget is reached. Today a silent executor is noticed only when an orchestrator restarts, because slots are refilled on completion notices and never by polling, and after a quota stop nothing wakes the system when the window resets or a budget is raised. The owner would be the watchdog. Long-running systems use heartbeats with timeouts, a start-to-finish deadline, an escalating ladder and a scheduled resume; for agents the heartbeat is observable progress, not a ping the agent must remember. The owner decided this lands before v0.1.0-rc.1.

## Done when

- **Progress, not pings.** For each dispatch the adapter records progress signals the agent does not have to send: commits and file changes in its worktree, tool calls and tokens from the harness, and for a headless process its liveness and output.
- **Watchdog.** `hitld dispatch watch`, a script with no model tokens, run on the chief of staff's schedule, finds dispatches with no progress for `dispatch.stall_after` (scaled by tier and estimate) or past a start-to-finish deadline.
- **Ladder.** A stalled dispatch is poked first (the same agent is asked to report its status); if that fails it is interrupted and continued as a follow-up with its commits kept; if that fails it is abandoned and re-dispatched; only after repeated failures does it become a question for the owner, through the attention budget (HITLD-84).
- **Resume after limits.** When the quota gate pauses dispatch it records why and when the limiting window resets (the status line's `resets_at`, or the declared reset); the chief of staff schedules a wake-up for that time. A raised budget through `hitld config write` re-plans dispatch at once. An executor cut off by a limit is found by the watchdog after the reset and continued as a follow-up.
- **Recorded.** Stalls, pokes, follow-ups, abandonments and resumes are ledger events; stall rates per model, tier and area appear in the measures and feed calibration.
- **Tested.** Tests cover a stall at each step of the ladder, a deadline, a pause and resume at a reset, and a budget raise; an offline eval scenario hangs a fake executor and checks the system recovers without the owner.
- Design parts 5, 12 and 13 describe the watchdog and the resume.

