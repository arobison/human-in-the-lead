---
id: HITLD-719
title: Close HITLD-30 now and file the automatic-call gap
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Close it, file the gap: Close HITLD-30 as done and file one new item for the automatic call."
answered_at: 2026-11-22T00:58:30.162Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-30 is still planned on main though PR 395 delivered most of it. Close it as done and file the gap as its own item?

PR 395 delivered reproduce open/run/check/item, a best-effort sandbox, the failing-twice rule, the guard and five offline scenarios. The OS-level boundary is HITLD-667. Nothing calls the reproducer automatically before an executor starts.

## Options and recommendation

- A. Close it, file the gap: Close HITLD-30 as done and file one new item for the automatic call.
- B. Keep it open: Leave HITLD-30 planned until the automatic call exists.
- C. Show me the Done-when first: Paste the Done-when next to what PR 395 delivered.

Recommended: Close it, file the gap. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
