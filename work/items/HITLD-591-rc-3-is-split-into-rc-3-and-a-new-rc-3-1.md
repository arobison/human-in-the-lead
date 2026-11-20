---
id: HITLD-591
title: rc.3 is split into rc.3 and a new rc.3.1
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: "A. Split into rc.3 and a new rc.3.1: rc.3 keeps its meaning (189, 190, 191, 404); a new 0.1.0-rc.3.1 holds 192 and 405 and needs rc.3; rc.4 then needs rc.3.1"
answered_at: 2026-11-20T00:38:06.218Z
answered_via: question-tool
answered_by: owner
---

## Question

Should rc.3 be split?

rc.3 holds 80 open items across six milestones with two outcomes: the run holding up (HITLD-189, 190, 191, 404) and the owner's view and the chief of staff's behavior (HITLD-192, 405). The curator's roadmap audit proposed a split; semver orders rc.3 < rc.3.1 < rc.4.

## Options and recommendation

- A. Split into rc.3 and a new rc.3.1: rc.3 keeps its meaning (189, 190, 191, 404); a new 0.1.0-rc.3.1 holds 192 and 405 and needs rc.3; rc.4 then needs rc.3.1
- B. Keep one rc.3, fix the dependency edges only: Move HITLD-146 and 298 only
- C. Split and renumber: rc.3 run mechanics, rc.4 owner's view, rc.5 adoption, rc.6 earns trust

Recommended: Split into rc.3 and a new rc.3.1. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
