---
id: HITLD-689
title: "UI freshness: how is a project's page produced and kept current?"
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: "A. Static file, regenerated on events: hitld dashboard writes one self-contained file, regenerated when the tracker or ledger changes and on demand; it states when and where its data was read."
answered_at: 2026-11-21T17:02:17.330Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-681 question 7 of 7.

The design avoids a service: a command costs tokens only when called.

## Options and recommendation

- A. Static file, regenerated on events: hitld dashboard writes one self-contained file, regenerated when the tracker or ledger changes and on demand; it states when and where its data was read.
- B. Static file, only on demand: Regenerated when someone runs the command.
- C. A small local server: Always current; a service to run and secure.

Recommended: Static file, regenerated on events. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
