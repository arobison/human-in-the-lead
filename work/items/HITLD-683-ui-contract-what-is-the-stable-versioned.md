---
id: HITLD-683
title: "UI contract: what is the stable, versioned surface that HITLD's page and a project's extensions read?"
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: "A. Everything the dashboard reads today: Items and their fields (including a project's declared fields), claims, state history, ledger summaries and usage, as one contract with an api_version; adding a field keeps the version, removing or retyping raises it."
answered_at: 2026-11-21T16:58:03.522Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-681 question 1 of 7. Which data does the view-model contract cover?

The dashboard already has a data contract (hitld dashboard --json) and a versioned read API for the tracker.

## Options and recommendation

- A. Everything the dashboard reads today: Items and their fields (including a project's declared fields), claims, state history, ledger summaries and usage, as one contract with an api_version; adding a field keeps the version, removing or retyping raises it.
- B. Tracker data only at first: Items, claims and state history with the project's fields; ledger summaries and usage later.
- C. Let the project choose what it exposes: A core part and optional parts a project turns on.

Recommended: Everything the dashboard reads today. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
