---
id: HITLD-781
title: The executor guard identifies an executor by its claim branch, so cloud executor sessions are guarded and metered
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

Found by the executor-model exploration (owner decision HITLD-779): the executor guard recognizes an executor only by a subagent type or the `HITLD_DISPATCH` variable (core/harness/claude-code/hooks/input.mjs), and `create_session` offers no way to set the variable, so executor sessions started in the cloud are likely unguarded and unmetered. [Likely]: not yet tested whether the plugin hooks run in those sessions. This is a security gap, so it is in rc.2.

## Done when

- A first step verifies whether the guard and plugin hooks run in a cloud executor session, and records the result in the item.
- The guard recognizes an executor from its checked-out claim branch (`hitld/<item>` with a claim commit) as well as the variable and the subagent type, so a cloud session on a claim branch gets the executor guard.
- A test shows an executor-branch session denied a command an executor may not run, and an orchestrator or owner session on another branch unaffected.
- A guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.
