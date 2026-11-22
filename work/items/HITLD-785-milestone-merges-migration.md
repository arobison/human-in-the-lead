---
id: HITLD-785
title: "Milestone merges: migration"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. A migrate command, both forms read for one release: hitld work migrate constraints-on-items moves every link and removes the milestone line; both forms are read until migrated (item side wins) with a check warning; milestone-side reading removed in rc.3."
answered_at: 2026-11-22T03:49:39.629Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-767 question 2: how does the move of constraint links happen, including for other projects' trackers?

Consuming projects have trackers with milestone-side constraint lists.

## Options and recommendation

- A. A migrate command, both forms read for one release: hitld work migrate constraints-on-items moves every link and removes the milestone line; both forms are read until migrated (item side wins) with a check warning; milestone-side reading removed in rc.3.
- B. Migrate everything at once, no dual reading: One run, then rc.2 stops reading the old form.
- C. Only new items use the item side: Both forms coexist indefinitely.

Recommended: A migrate command, both forms read for one release. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
