---
id: HITLD-418
title: How usage limits are reported and gated on Claude Team and Enterprise plans
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Done when




- The question is answered from primary sources and recorded in `docs/reference/harness-usage-sources.md`: for seat-based Team and Enterprise, usage-based Enterprise and Pro, Max and Ultra, which windows exist (five-hour, weekly, a spend or credits limit), what the Claude Code status line reports for each (`rate_limits.five_hour`, `rate_limits.seven_day`, `rate_limits.spend_limit`, nothing), and what `/usage`, the admin console and any API show. Each line names its page and the date it was read; anything not confirmed says so.
- Where the status line reports nothing, the item says how an owner on that plan gives the gate a limit and a reading (the person file's declared limit and an owner-declared snapshot), and the new-project guide says it.
- If the answer needs a gate or schema change (for example a spend limit in dollars, HITLD-417), it is filed as its own item and put to the owner; this item changes docs only.
- `npm run check` and `hitld work check` pass.

## Why

The owner asked on 2026-11-16 how limits are reported for Team and Enterprise plans, while deciding HITLD-151 (keep five-hour support but stop requiring it). A first read of the public pages (by the chief of staff's helper, 2026-11-16): seat-based Team and Enterprise have a per-seat allowance on a rolling five-hour window and a weekly window (code.claude.com/docs/en/costs.md); usage-based Enterprise has no per-seat limits; Ultra has a weekly limit only. Not confirmed: whether the status line's `rate_limits` reaches Team or Enterprise seats (the statusline page says it appears for claude.ai Pro, Max and Ultra subscribers, or behind a gateway that sets a spend limit; that rule was read second-hand), and whether `/usage` shows percentages for those seats. Two articles were not read: the usage-based Enterprise billing article and the Team usage credits article. The existing reference doc covers Pro, Max and Ultra only.

## Notes

Related: HITLD-151 (the five-hour limit), HITLD-417 (the spend limit window), HITLD-165 (the quota probe). The owner's own plan is Ultra, so a Team or Enterprise reading needs someone with that plan to check what their status line prints; say so in the item if the pages cannot settle it.

Correction added 2026-11-16 (the owner asked whether the status line had not been dropped): the owner decided to retire the status-line usage capture and use the probe everywhere (HITLD-173, built by HITLD-165). So the question this item answers for Team and Enterprise is what the `claude` command's `rate_limit_event` (and the plan's usage page) reports for those plans, not only what the status line's `rate_limits` reports; read the `claude` command's output on a Team or Enterprise seat before relying on the status line pages.
