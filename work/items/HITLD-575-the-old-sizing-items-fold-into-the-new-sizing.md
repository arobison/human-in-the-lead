---
id: HITLD-575
title: The old sizing items fold into the new sizing build, except two small fixes
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: "A. Fold 287 and 500 into the new sizing build, keep 285 and 286 as fixes: 287 and 500 close when HITLD-561 lands; 285 and 286 stay as independent fixes"
answered_at: 2026-11-20T00:02:09.803Z
answered_via: question-tool
answered_by: owner
---

## Question

What happens to the four open items about the old sizing (HITLD-285, 286, 287, 500)?

HITLD-533 and HITLD-561: an item's tier and cost come from measured history with the plan as the prior. HITLD-287 (sizing reads a Plan section nothing tells a project to write) and HITLD-500 (sizing ignores required reading) describe the old model; HITLD-285 (inline_globs ignores work_dir) and HITLD-286 (touches off by default) are small defaults bugs consumers hit now.

## Options and recommendation

- A. Fold 287 and 500 into the new sizing build, keep 285 and 286 as fixes: 287 and 500 close when HITLD-561 lands; 285 and 286 stay as independent fixes
- B. Fold all four into the sizing build: One item owns sizing
- C. Keep all four as they are: Fix them as written

Recommended: Fold 287 and 500 into the new sizing build, keep 285 and 286 as fixes. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
