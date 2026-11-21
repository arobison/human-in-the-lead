---
id: HITLD-686
title: "UI evidence panels: how does an evidence source put data on the page?"
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: "A. Typed fragments with a label: The adapter returns a JSON fragment with a panel type, the data and a classification label; HITLD renders it and refuses unlabeled data or data whose label does not allow the page's reach."
answered_at: 2026-11-21T16:59:37.566Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-681 question 4 of 7. How do adapter results reach the page?

The adapter's command is an owner-approved executing property; it names no code in data.

## Options and recommendation

- A. Typed fragments with a label: The adapter returns a JSON fragment with a panel type, the data and a classification label; HITLD renders it and refuses unlabeled data or data whose label does not allow the page's reach.
- B. References only: IDs and headlines; HITLD never renders the data.
- C. Both, chosen per panel: A panel declares which.

Recommended: Typed fragments with a label. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
