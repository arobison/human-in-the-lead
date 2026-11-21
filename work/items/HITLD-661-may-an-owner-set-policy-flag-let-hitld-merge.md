---
id: HITLD-661
title: May an owner-set policy flag let hitld merge refuse when the private term list is absent?
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: A
answered_at: 2026-11-21T04:49:11.228Z
answered_via: question-tool
answered_by: owner
---

## Question

Refusing by default would stop every cloud executor commit and every cloud pull request check, because a cloud session has the store address but not the key. Should an opt-in policy flag exist so a local owner can choose to refuse?

Pull request 404 review. The merge row of design 10.3 is the one marked Enforces: Yes; with the list absent it only warns today.

## Options and recommendation

- A. Add an opt-in flag, off by default: A policy setting makes hitld merge refuse when the list is absent. Cloud sessions keep working by default; a local owner can turn it on.
- B. No flag: The merge only warns when the list is absent.

Recommended: Add an opt-in flag, off by default. It keeps cloud sessions working and gives a local owner the stricter choice.

## Answer

Open.
