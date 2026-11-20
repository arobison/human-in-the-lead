---
id: HITLD-549
title: Projects are blind to each other and share the pace through the account total
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: I think blind with no ceiling is right. Surely there is some existing literature on controller theory or scheduling that can help here
answered_at: 2026-11-19T23:41:05.224Z
answered_via: question-tool
answered_by: owner
---

## Question

How should several projects share one account's pace, given the risk of confidential information leaking between projects?

HITLD-531 chose a person-level layer that computes shares, which makes projects aware of each other: it reveals that other projects exist and when they are active, adds a credential every project holds, and lets one compromised project distort the others. The probe (HITLD-165) reads the account's real total utilization, which every project can use as the shared signal.

## Options and recommendation

- A. Blind, with an owner-set ceiling per project: Each project follows the line on the account total and holds a fixed ceiling the owner sets in its own policy
- B. Blind, no ceilings: Each project follows the line on the account total and nothing else
- C. Keep the person-level layer: HITLD-531 as decided: shares computed across projects

Recommended: Blind, with an owner-set ceiling per project. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
