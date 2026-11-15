---
id: HITLD-108
title: Adopt design 0003, a remote for the private store
kind: decision
state: done
created: 2026-11-15
project: HITLD-15
decider: owner
answer: Adopt design 0003, with the recommended answer to Q1 to Q7, and v0.1.0-rc.1 waits for it (Q8)
answered_at: 2026-11-15T06:30:00Z
answered_by: owner
answered_via: main-session
---

## Question

Adopt design 0003 (`docs/design/0003-private-store-remote.md`): each project's private store follows the owner between machines and sessions as a synced, encrypted copy behind a `StoreRemote` interface, with one key pair per device enrolled by a reviewable commit, a private GitHub repository per project as the first transport, and every move and all key handling done by `hitld` code, never the model?

## Options and recommendation

- **Adopt, answering Q1 to Q8 in turn (recommended).** Section 15 records each answer.
- Keep `store sync` with a file carried by hand.

## Answer

Adopt design 0003. The owner answered Q1 to Q8 one at a time in the main session: the recommendation on Q1 to Q7, and on Q8 that v0.1.0-rc.1 waits for this milestone.
