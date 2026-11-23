---
id: HITLD-974
title: Cut six second-review security items from rc.2 to rc.3 (873, 887, 889, 890, 891, 892)
kind: decision
state: done
created: 2026-11-23
project: HITLD-15
decider: owner
answer: "A. Move all six: Recommended cut"
answered_at: 2026-11-23T06:06:59.804Z
answered_via: question-tool
answered_by: owner
---

## Question

Move these six security items from rc.2 to rc.3?

They guard against a hostile store, hostile feedback or a hostile branch. The executor-enforcement chain (856, 857, 867 to 872), 888 (non-main workflow runs and the release-environment tag path) and the forge setup (952 to 955) stay in rc.2.

## Options and recommendation

- A. Move all six: Recommended cut
- B. Move 873, 891, 892; keep 887, 889, 890: Partial
- C. Keep all six: No cut

Recommended: Move all six. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
