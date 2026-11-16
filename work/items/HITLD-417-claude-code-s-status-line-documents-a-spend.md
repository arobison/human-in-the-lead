---
id: HITLD-417
title: Claude Code's status line documents a spend limit window that HITLD ignores
kind: work
state: dropped
reason: "Dropped by the owner on 2026-11-16 (HITLD-432): the status line reports a spend_limit window only behind a gateway, nobody known needs it, and the owner is on Ultra; it reopens if a plan needs it (see HITLD-418)."
created: 2026-11-16
project: HITLD-15
---

## Done when




- The owner decides, in a walk-through, whether the quota gate reads the status line's `rate_limits.spend_limit` (`used_usd`, `limit_usd`, `period`) as a limit, and if so what unit it has (dollars, not plan percent) and how the reserve and the forecast treat it.
- If yes, the snapshot schema, the usage reader, the default limit list and the docs follow, with tests; if no, the item is dropped with the owner's reason and the usage reader's note says the field is ignored on purpose.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Found by the executor of D-30 (HITLD-151), reported as not blocking: the Claude Code status line docs now document a third window, `rate_limits.spend_limit`, beside `five_hour` and `seven_day`. HITLD ignores it (`core/lib/quota/statusline.mjs`, lines 51 to 52). Accounts billed by spend would not be gated on it.

## Notes

Design-heavy (a new unit for the gate): stays proposed and is walked through with the owner. Related: HITLD-151 (the five-hour limit), HITLD-165 (the quota probe).
