---
id: HITLD-806
title: The executor contract and the brief say each report list line starts with a dash
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-764]
---

## Done when



## Why

On 2026-11-22 the HITLD-764 executor sent a report whose lists were indented two spaces but had no leading "- ". `parseReport` refused all 15 lines under evidence, deviations and calls as "unexpected line", and the dispatch was recorded with errors and needed a follow-up. The contract (`templates/AGENTS.contract.md`, line 28, HITLD-778) and the orchestrator's brief text say lists are indented two spaces under their heading, and never that each item starts with "- ".

## Done when

- `templates/AGENTS.contract.md`, its plugin copy and the orchestrate skill's brief text say each list item is one line, indented two spaces and starting with "- ", with an example block.
- A test parses a report written exactly as the contract describes, and one without the dash is refused with the line named.
- A contract change reaches main only with the owner's own yes. `hitld work check` and the offline eval gate pass.
