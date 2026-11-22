---
id: HITLD-915
title: The build tool shares dependency caches; HITLd exports the variable and reports size
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. The tool shares; HITLd exports the variable and reports size: No links created by HITLd."
answered_at: 2026-11-22T20:53:16.663Z
answered_via: question-tool
answered_by: owner
---

## Question

Who shares dependency caches between worktrees (HITLD-883 decision 7 of 12)?

The profile names the cache and its variable; HITLd never creates links itself. Lands in rc.3.

## Options and recommendation

- A. The tool shares; HITLd exports the variable and reports size: No links created by HITLd.
- B. HITLd manages shared caches itself: Locking and corruption handling per tool.
- C. No cache handling: Leave installs as they are.

Recommended: The tool shares; HITLd exports the variable and reports size. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
