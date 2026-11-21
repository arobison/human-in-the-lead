---
id: HITLD-671
title: Which sessions get the private store repository attached when they are created?
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: A. Every sub-session that needs the store gets it attached|Any sub-session that needs the store has the store repository attached, and the chief of staff makes sure it is. A session cannot be given a repository by another session, so the chief of staff passes the attach tool when creating it and the session attaches the repository itself (the rule already in the chief-of-staff skill, HITLD-142). Sessions that do not need the store never get it.
answered_at: 2026-11-21T06:47:09.876Z
answered_via: chat
answered_by: owner
---

## Question

A sub-session that needs the private store (an orchestrator that pushes the run ledger) cannot reach it unless the store repository is attached to that session. Orch-4 was created without it, so its store push failed. Should the chief of staff attach it whenever it creates a session that needs the store?

Orch-4's read-only diagnosis (2026-11-21): its device key is set and matches the approved device, but git cannot reach the store remote because the repository is not a source of its session.

## Options and recommendation

- A. A: Every sub-session that needs the store gets it attached|Any sub-session that needs the store has the store repository attached, and the chief of staff makes sure it is. A session cannot be given a repository by another session, so the chief of staff passes the attach tool when creating it and the session attaches the repository itself (the rule already in the chief-of-staff skill, HITLD-142). Sessions that do not need the store never get it.
- B. B: Never attach it to sub-sessions|Only the chief of staff holds the store.

Recommended: A. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.

## Note

No session can attach a repository to another, and `create_session` takes one repository at start. The rule is therefore already written in the chief-of-staff skill (HITLD-142, done): pass the attach tool in `extra_allowed_tools` so the session attaches the store repository itself in its store check. Orch-4 was created without that grant or its attach was refused; the chief of staff did not catch it. The fix is practice, not a new item.
