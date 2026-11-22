---
id: HITLD-698
title: Description signals are recorded against the entity and the guide's rules are checked against outcomes
kind: work
state: planned
created: 2026-11-21
project: HITLD-28
needs: [HITLD-75]
constraint_of: [HITLD-408 c3]
---

## Why

Split from HITLD-75 (the owner's choice on 2026-11-21): HITLD-75 built the writing guide, the deterministic check and the description-quality eval (its first three Done-when clauses). Its last two clauses, recording signals that a description was poor and checking the guide's rules against outcomes, need run data that does not exist yet, so they are their own item. Original context: agents write most of the tracker, every description is read many times, and nothing yet measures how often a poor one costs questions, deviations or rework.

## Done when

- Signals that a description was poor are recorded against the entity: questions an executor sent back, deviations caused by an unclear scope, rework, and the owner's edits to agent-written text. They appear in the digest, and they are the evidence for proposing changes to the guide.
- The guide's rules are checked against outcomes: descriptions that scored low show more questions or rework, or the rule is revised.
- `hitld work check`, `npm run check` and the offline eval gate pass.

## Plan

Design 17 (evals, brief quality) and 18 (learning from signals); the signals are ledger events, so they follow the ledger event rules (unique IDs, HITLD-74).
