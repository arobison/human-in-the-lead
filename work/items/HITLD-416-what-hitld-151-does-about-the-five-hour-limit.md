---
id: HITLD-416
title: What HITLD-151 does about the five-hour limit
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Keep support, stop requiring it: claude-five-hour leaves the default list; the window value and snapshot field stay; the gate adds a five-hour limit only when the account shows one; docs say it applies to Pro and Max; the item is reworded."
answered_at: 2026-11-16T19:23:19.877Z
answered_via: question-tool
answered_by: owner
---

## Question

What should HITLD-151 do, given that Pro and Max plans still have a five-hour limit and only verified Ultra accounts do not?

The executor's sources: the status line docs still list a five_hour window; a support article says verified Ultra accounts have none.

## Options and recommendation

- A. Keep support, stop requiring it: claude-five-hour leaves the default list; the window value and snapshot field stay; the gate adds a five-hour limit only when the account shows one; docs say it applies to Pro and Max; the item is reworded.
- B. Remove as written: Drop the limit, rolling_5h and the snapshot field.
- C. Keep everything, fix docs: No code change.

Recommended: Keep support, stop requiring it. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
