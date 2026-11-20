---
id: HITLD-579
title: An item is not done until the docs it affects are updated
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: part of an item being done in the future should include updating the relevant docs so they're always up to date
answered_at: 2026-11-20T00:06:37.992Z
answered_via: chat
answered_by: owner
---

## Question

Should part of an item being done include updating the relevant docs, so they are always up to date?

The owner said so in chat on 2026-11-20 while the design docs were found to be behind the tracker (HITLD-571, 572). HITLD-537: a rule an executor could break by accident is enforced by structure, not by brief text.

## Options and recommendation

- A. Updating the docs is part of every item's done: Every item's done-when says the docs and design parts it affects are updated in the same pull request; a command checks changed paths against a table of design parts and fails a change that needs docs and has none, unless it carries a Docs trailer with a reason; a change with that check red is not eligible to self-merge
- B. Brief text only: The done-when line and the executor brief say it, with no check
- C. A periodic docs sweep: A curator sweep finds drift after the fact

Recommended: Updating the docs is part of every item's done. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
