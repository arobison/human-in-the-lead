---
id: HITLD-836
title: Who runs the HITLD-767 migration and when
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Orchestrator runs it on main after 515 merges: One reviewable migration commit at a quiet moment for tracker PRs; the Done-when line is amended."
answered_at: 2026-11-22T07:18:34.229Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-767's migration rewrites 345 tracker files and an executor cannot run it. Who runs it, and when?

PR 515 builds the derived constraints list and the migration command; the migration is not run in the branch.

## Options and recommendation

- A. Orchestrator runs it on main after 515 merges: One reviewable migration commit at a quiet moment for tracker PRs; the Done-when line is amended.
- B. Orchestrator runs it before merge and pushes the result onto the branch: Migrated files ride in PR 515.
- C. Do not migrate now: Both forms stay readable; the check warns.

Recommended: Orchestrator runs it on main after 515 merges. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
