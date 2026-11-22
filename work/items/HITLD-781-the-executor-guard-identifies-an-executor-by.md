---
id: HITLD-781
title: The executor guard identifies an executor by its claim branch, so cloud executor sessions are guarded and metered
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80Q97GEKK8RZ9
---

## Why

Found by the executor-model exploration (owner decision HITLD-779): the executor guard recognizes an executor only by a subagent type or the `HITLD_DISPATCH` variable (core/harness/claude-code/hooks/input.mjs), and `create_session` offers no way to set the variable, so executor sessions started in the cloud are likely unguarded and unmetered. [Likely]: not yet tested whether the plugin hooks run in those sessions. This is a security gap, so it is in rc.2.

## Done when

- A first step verifies whether the guard and plugin hooks run in a cloud executor session, and records the result in the item.
- The guard recognizes an executor from its checked-out claim branch (`hitld/<item>` with a claim commit) as well as the variable and the subagent type, so a cloud session on a claim branch gets the executor guard.
- A test shows an executor-branch session denied a command an executor may not run, and an orchestrator or owner session on another branch unaffected.
- A guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Do the hooks run in a cloud executor session?

Checked on 2026-11-22 from inside a cloud executor session (dispatch D-01M80Q97GEKK8RZ9), before the change: **no.** [Certain] The session's user settings, the managed settings and the repository's own `.claude/` hold no hook or plugin entry for human-in-the-lead; the only hook configured is the platform's own stop hook, and no human-in-the-lead plugin is installed or enabled. So in such a session neither the guard nor the progress, report-check, session-start or store-sync hooks run at all. Second, even where the plugin is installed, the guard on main would not have known the session: `HITLD_DISPATCH` reaches only the `hitld` commands it prefixes, not the hook's environment; the guard on main, given this session's own environment and a `git push`, let it through.

So the change here (an executor known by its checkout) closes the recognition gap, and a cloud session gets the guard only once the plugin is enabled there. Enabling it in cloud sessions is outside this item's touches; it is the question in this dispatch's report.
