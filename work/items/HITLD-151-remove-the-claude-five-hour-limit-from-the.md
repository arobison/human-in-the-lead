---
id: HITLD-151
title: The Claude five-hour limit is no longer a default; the gate adds it where the plan has one
kind: work
state: done
created: 2026-11-16
project: HITLD-15
claimed_by: D-30
release_note: "A new project's default quota limits hold only `claude-weekly`. The `claude-five-hour` limit is no longer a default: the gate adds it while the account's status line reports a five-hour window that has not reset (Pro and Max plans; verified Ultra accounts have none). The `rolling_5h` window value and the usage snapshot's `five_hour` field stay."
---

## Why

The owner reported that Anthropic removed the five-hour usage window from Claude plans. The first step (below) found it is gone only for verified Ultra accounts: Pro and Max still have it. HITLd treated it as a default limit, so a new project got a `claude-five-hour` limit with no reading, and the quota gate stopped all dispatch until the owner declared a plan or installed a status line. On a plan without the window, that stop came from a limit the plan does not have. In the first self-hosted run, it was the first thing that blocked work. The owner chose option B (decision HITLD-416): keep five-hour support, but stop requiring it.

## Done when

- First step: confirm against the Claude Code status line's current input and Anthropic's plan documentation whether a five-hour window is reported, and record what each source says in the item (below).
- The default list of account limits no longer contains `claude-five-hour`. A new project's defaults hold the weekly limit (plus any run budget), and a subscription with only a weekly window gates dispatch on it.
- The gate adds a `claude-five-hour` limit only when the account shows one: when its latest status-line snapshot carries a `five_hour` window that has not reset. A limit on the `rolling_5h` window declared in the person file (or the project's) is used as declared, and nothing is added.
- The `rolling_5h` window value and the usage snapshot's `five_hour` field stay. The status-line capture reads `seven_day`, and `five_hour` when the plan has it.
- Design part 12 (the window table and the default limit), the README's account-limits paragraph, the dashboard and new-project guides, and `docs/reference/harness-usage-sources.md` say that the five-hour limit applies to Pro and Max plans only.
- Tests and the two orchestrator eval scenarios (`quota-pause-resume`, `watchdog-ladder`) are changed only where they depended on the default five-hour limit, with none skipped or removed to get green.
- The plugin copies are rebuilt. A new project's defaults contain no `claude-five-hour`.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session. The default of a schema value (the policy's default quota limits) changes, so it is part of the public interface; the `release_note` above says so, and HITLD-137's release note and the release record carry it. Evidence from 2026-11-16: the `rate_limit_event` the `claude` command printed in a cloud container listed only a `seven_day` window in `unifiedWindows`, with no five-hour window (HITLD-165). It is one sample; the first step below checked it against the sources. HITLD-149 (declared usage) and HITLD-56 (dropped) (the status-line readout, dropped) work on the same gate and should be built after this, or in one wave with care.

Also reported as GitHub issue #116 (friction, triage 2026-11-16): Default quota limits include a claude-five-hour rolling window the plan may lack; the person file had to replace the whole list to drop it. The issue is untouched on GitHub; this item covers it, and a second report raises its reach.

## First step: what the sources say (2026-11-16)

Read on 2026-11-16 by D-30. The sources contradict the item's premise for Pro and Max plans, so the removal waits for the owner.

- **Claude Code status line documentation** (code.claude.com, "Customize your status line", the "Available data" table and the full JSON schema): the input still documents `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` and `resets_at` (Unix seconds). The `rate_limits` object "appears only for claude.ai Pro, Max, and Ultra subscribers". "Each window (`five_hour`, `seven_day`, `spend_limit`) may be independently absent, and Claude Code drops a window once its `resets_at` time passes." A `spend_limit` window is also documented, for a Claude apps gateway.
- **Help center, "Using Claude Code with your Pro or Max plan"** (support.claude.com, article 11145838): "Pro and Max plans have a five-hour session limit and a weekly limit. Ultra plans have a weekly limit, and verified Ultra accounts don't have a five-hour session limit."
- **Help center, "Usage limit best practices"** (article 9797557): the usage page shows "Current session", described as the plan's five-hour session limit, and "Weekly limits".
- **Pricing page** (claude.com/pricing): Pro and Max get usage "every 5 hours and every week"; Ultra: "No 5-hour limit" for verified accounts and "10x Pro usage every week". Its comparison table has a "Limit every 5 hours" row (Limited, 1x, 5x, No 5-hour limit) and a "Limit every week" row.
- The two older plan-usage articles (11014257 for Max, 8324991 for Pro) return 404.

Reading: the five-hour window is gone only for verified Ultra accounts; Pro and Max still have it, and the status line still reports it when the account has it. The sample in HITLD-165 (a `rate_limit_event` listing only `seven_day`) fits an account without the window, or a window dropped after its reset, and does not show a change for all plans. Removing the five-hour limit from the code would leave Pro and Max subscribers without a gate on a limit their plan has. The question of scope went to the owner through the orchestrator, who chose option B (decision HITLD-416).
