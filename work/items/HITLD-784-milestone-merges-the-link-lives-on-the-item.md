---
id: HITLD-784
title: "Milestone merges: the link lives on the item"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. The link lives on the item; the milestone's list is derived: Each item carries constraint_of."
answered_at: 2026-11-22T03:49:30.714Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-767 question 1: how do two tracker pull requests that add items to one milestone merge without a hand-resolved conflict?

A hand resolution happened five times in one session.

## Options and recommendation

- A. The link lives on the item; the milestone's list is derived: Each item carries constraint_of.
- B. One small file per constraint and per note: A milestone becomes a directory.
- C. One constraint per line plus a union merge attribute: Smallest change.

Recommended: The link lives on the item; the milestone's list is derived. x

## Answer

Recorded in the front matter once answered.
