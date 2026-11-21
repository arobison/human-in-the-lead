---
id: HITLD-687
title: "UI code extensions: may a project run its own script on the page?"
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: "A. No script from projects: Extensions are data only; anything needing script is added to HITLD itself through a release."
answered_at: 2026-11-21T17:01:03.324Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-681 question 5 of 7.

The rule from the dyno exchange: configuration names no code to run, except in a property HITLD marks as executing and the owner approves.

## Options and recommendation

- A. No script from projects: Extensions are data only; anything needing script is added to HITLD itself through a release.
- B. Versioned panel code in the pinned plugin: Reviewed and owner-approved like any code change.
- C. Owner-approved project script: A named script run in a sandboxed frame; riskiest.

Recommended: No script from projects. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
