---
id: HITLD-966
title: Merge PR 570 (HITLD-899, upgrading to release packages)
kind: decision
state: done
created: 2026-11-23
project: HITLD-15
decider: owner
answer: "A. Yes, merge: Record the yes and the queue merges it"
answered_at: 2026-11-23T01:21:44.454Z
answered_via: question-tool
answered_by: owner
---

## Question

Merge pull request 570, which changes the release path (release check and release migrate)? All eleven checks green on head d623fda.

Release-path change needs the owner's own yes. Nothing is tagged, published or migrated by it. The executor flagged release.mjs outside its listed files.

## Options and recommendation

- A. Yes, merge: Record the yes and the queue merges it
- B. No, hold it: Leave it open; HITLD-854 keeps waiting

Recommended: Yes, merge. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
