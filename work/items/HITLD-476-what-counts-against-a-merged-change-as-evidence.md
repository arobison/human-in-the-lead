---
id: HITLD-476
title: What counts against a merged change as evidence
kind: decision
state: done
created: 2026-11-18
project: HITLD-15
decider: owner
answer: "A. All four count: A revert; a fix-forward item citing the merge; a failing check on main traced to it; the owner's report."
rationale: a revert; a fix-forward item citing it; a failing check on main; the owner's report
answered_at: 2026-11-18T05:24:19.176Z
answered_via: question-tool
answered_by: owner
---

## Question

What should count against an unlocked kind of change after it merged? Any one of these would cost it trust.

Most defects in this project were fixed forward by a new item rather than reverted, so a revert alone misses them.

## Options and recommendation

- A. All four count: A revert; a fix-forward item citing the merge; a failing check on main traced to it; the owner's report.
- B. Fewer: The owner names which.

Recommended: All four count. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
