---
id: HITLD-151
title: Remove the Claude five-hour limit from the design, defaults, code, docs and evals
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

The owner reports that Anthropic removed the five-hour usage window from Claude plans, leaving the weekly limit only. HITLd still treats it as a default limit. A new project gets a `claude-five-hour` limit with no reading, so the quota gate stops all dispatch until the owner declares a plan or installs a status line. In the first self-hosted run that stop was the first thing that blocked work, and it was a limit the owner's plan does not have. The owner asked for it to be removed before rc.2.

## Done when

- First step: confirm against the Claude Code status line's current input and Anthropic's plan documentation that no five-hour window is reported, and record what each source says in the item. The owner's report is the reason to look, and the sources settle it.
- The default list of account limits no longer contains `claude-five-hour`. A new project's defaults hold the weekly limit and the run's token budget, and a subscription with only a weekly window gates dispatch on it.
- Every description of the five-hour window is removed or corrected: design part 12 (`12-reporting-and-limits.md`, the window table), the README's account-limits paragraph, the dashboard and new-project guides, and `docs/reference/harness-usage-sources.md`. The status-line capture reads `seven_day` and ignores a `five_hour` field if a harness still sends one.
- The `rolling_5h` window value and the `five_hour` field of the usage snapshot are removed from the schemas and the window code (`core/lib/quota/window.mjs`, `usage.mjs`), unless the owner decides to keep a rolling window for other providers, in which case the value is renamed so it does not name Claude. This is the owner's decision; the first step puts it to them.
- The two orchestrator eval scenarios that pause dispatch at the five-hour reserve (`quota-pause-resume`, `watchdog-ladder`) are rewritten around the weekly window, with a reset that is days away, so they still show a pause, a wake at the reset and a resume. The committed offline baseline is accepted again from a clean run on the final main.
- The tests that name the five-hour limit (quota, policy, settings, watchdog and machine-registry tests) are updated to the weekly limit, with none skipped or removed to get green.
- The plugin copies are rebuilt. A search of the repository for `five-hour`, `five_hour` and `rolling_5h` finds nothing, apart from a release note that says the limit was removed.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. A schema value is removed, so it is part of the public interface; HITLD-137's release note and the release record say so. Evidence from 2026-11-16: the `rate_limit_event` the `claude` command printed in a cloud container listed only a `seven_day` window in `unifiedWindows`, with no five-hour window (HITLD-165). It is one sample, and the first step of this item still confirms it. HITLD-149 (declared usage) and HITLD-56 (dropped) (the status-line readout, dropped) work on the same gate and should be built after this, or in one wave with care.

Also reported as GitHub issue #116 (friction, triage 2026-11-16): Default quota limits include a claude-five-hour rolling window the plan may lack; the person file had to replace the whole list to drop it. The issue is untouched on GitHub; this item covers it, and a second report raises its reach.
