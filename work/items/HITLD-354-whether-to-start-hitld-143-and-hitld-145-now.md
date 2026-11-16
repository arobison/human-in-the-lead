---
id: HITLD-354
title: Whether to start HITLD-143 and HITLD-145 now
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Not yet: Nothing starts; the run stays idle by instruction; an item for an owner hold switch is filed; both are walked through first."
answered_at: 2026-11-16T17:36:12.042Z
answered_via: question-tool
answered_by: owner
---

## Question

Start executors on HITLD-143 (reversible tracker edits without a per-change owner approval) and HITLD-145 (machine cap only for executors that share a machine) now?

The scheduler offered them after HITLD-52 and 97 were held. Both change policy and decision rights, so the owner decides their design first.

## Options and recommendation

- A. Not yet: Nothing starts; the run stays idle by instruction; an item for an owner hold switch is filed; both are walked through first.
- B. Start both: Two large executors at about 400k tokens each; the PRs then need the owner's own yes.
- C. Start HITLD-145 only: Only the machine-cap item starts.

Recommended: Not yet. Design-heavy items are decided by the owner before they are built.

## Answer

Recorded in the front matter once answered.
