---
id: HITLD-778
title: The executor contract says exactly what the commit line of a report may hold
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
release_note: "The executor contract says the report's commit line is exactly `commit: <full sha> (branch <name>)`, with branch notes under `deviations`."
claimed_by: D-01M80T9RYAVSGCGX
---

## Why

Reported from a consumer project as GitHub issue 430 and seen again in the first run: several executor reports carried extra text after the branch name on the commit line, and each one needed a follow-up. The parser fix is HITLD-280; the contract text an executor reads does not say exactly what that line may hold, or that a note belongs under `deviations`.

## Done when

- `templates/AGENTS.contract.md` (and the plugin copy) says the commit line is exactly `commit: <full sha> (branch <name>)` with nothing after the closing bracket, that a note about the branch goes under `deviations`, and that every list line is indented two spaces under its heading.
- The orchestrate skill's brief text carries the same sentence.
- A contract change reaches main only with the owner's own yes. `hitld work check` and the offline eval gate pass.
