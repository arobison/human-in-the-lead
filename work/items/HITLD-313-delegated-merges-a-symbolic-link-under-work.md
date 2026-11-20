---
id: HITLD-313
title: "Delegated merges: a symbolic link under work/ waits for the owner"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Guard it: a link waits for me: A PR that adds or changes a symlink waits for the owner."
answered_at: 2026-11-16T06:18:14.565Z
answered_via: question-tool
answered_by: owner
---

## Question

A symbolic link under work/ would merge without asking. Guard it?

PR #207 (HITLD-150): merge authority holds on the pull request path.

## Options and recommendation

- A. Guard it: a link waits for me: A PR that adds or changes a symlink waits for the owner.
- B. Enough as is: Rely on work check.

Recommended: Guard it: a link waits for me. The delegation should not be crossed by a link.

## Answer

Recorded in the front matter once answered.
