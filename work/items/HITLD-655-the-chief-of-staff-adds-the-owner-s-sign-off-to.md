---
id: HITLD-655
title: The chief of staff adds the owner's sign-off to every squash commit it merges
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: Yes, add mine (Recommended)
answered_at: 2026-11-20T21:25:14.197Z
answered_via: question-tool
answered_by: owner
---

## Question

Main's DCO check is red because squash commits the chief of staff merged carry no Signed-off-by line. May the chief of staff add the owner's sign-off to each squash commit it merges with the owner's yes?

The DCO check on main requires the approver's Signed-off-by on every squash commit. Merges by the chief of staff since HITLD-595 carry the owner's name and noreply address as the commit author but no sign-off, so the main check fails for them.

## Options and recommendation

- A. Yes, add the owner's: Each squash commit gets a Signed-off-by line with the owner's GitHub name and noreply address, for merges the owner approved
- B. No, the owner signs: The chief of staff stops merging and brings each pull request ready; the owner merges in the web UI
- C. Change the check: Exempt squash commits made through the merge button; filed as a design item

Recommended: Yes, add the owner's. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
