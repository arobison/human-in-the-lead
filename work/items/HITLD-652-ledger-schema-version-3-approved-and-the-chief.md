---
id: HITLD-652
title: Ledger schema version 3 approved, and the chief of staff decides which pull requests get an independent review
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: You decide which need a review and review them; merge the rest. OK to have the ledger schema version bump.
answered_at: 2026-11-20T19:44:32.602Z
answered_via: chat
answered_by: owner
---

## Question

May the ledger move to schema version 3 (older releases then refuse such a store), and who decides which open pull requests get an independent review before merge?

Pull request 393 (HITLD-74) makes event and dispatch IDs unique and gives each writer its own ledger file; once any version-3 line is written, older releases refuse that store. Five pull requests were waiting on the owner's yes.

## Options and recommendation

- A. Approve the bump: Ledger lines move to schema version 3 as built in 393
- B. Hold the bump: Keep version 2 and rework 393

Recommended: Approve the bump. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
