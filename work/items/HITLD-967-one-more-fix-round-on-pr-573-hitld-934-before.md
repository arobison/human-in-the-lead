---
id: HITLD-967
title: One more fix round on PR 573 (HITLD-934) before merging
kind: decision
state: done
created: 2026-11-23
project: HITLD-15
decider: owner
answer: "B. One more fix round: Third follow-up for both defects, then another read before merging"
answered_at: 2026-11-23T03:56:07.297Z
answered_via: question-tool
answered_by: owner
---

## Question

Merge pull request 573 now and file two narrow defects as a follow-up, do one more fix round first, or hold it?

The second independent read confirmed the four earlier fixes and found two narrower defects: a non-ASCII secret split across output chunks is not redacted, and a refused release of a bind-mounted worktree first saves the mounted files into the local branch. Both exist on main today.

## Options and recommendation

- A. Merge and file follow-up: Merge now, file the two defects for rc.3
- B. One more fix round: Third follow-up for both defects, then another read before merging
- C. Hold it: Leave PR 573 open

Recommended: Merge and file follow-up. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
