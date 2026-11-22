---
id: HITLD-874
title: Cut the large optional builds from rc.2 to rc.3 and freeze rc.2's constraint set
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Yes, cut and freeze: Move the listed items to their rc.3 and later milestones; freeze the rc.2 constraint set; new friction goes to rc.3 by default."
answered_at: 2026-11-22T18:54:14.436Z
answered_via: question-tool
answered_by: owner
---

## Question

Should the trust engine, batching, dollars and dashboard work, the executor ceiling command and the hand-merge command leave rc.2, and the rc.2 constraint set freeze?

The Fable plan review found rc.2 cannot converge (about 70 items added in one day) and its own proof (install rc.1 and the live test) has not happened. The batching review found the batch-PR design breaks what the owner's yes binds to. This reverses decision HITLD-850.

## Options and recommendation

- A. Yes, cut and freeze: Move the listed items to their rc.3 and later milestones; freeze the rc.2 constraint set; new friction goes to rc.3 by default.
- B. Freeze only; keep these items: Stop adding to rc.2 only.
- C. Cut some; the owner names which: Partial cut.
- D. Leave rc.2 as is: Keep HITLD-850.

Recommended: Yes, cut and freeze. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
