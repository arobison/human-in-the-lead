---
id: HITLD-981
title: A fix round that keeps finding new Important problems in code the last round added stops and escalates to a structural analysis, and the merge policy says what blocks after N rounds
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-408 c?]
---

## Done when

- Policy holds a setting for the number of fix rounds after which an item pauses and a structural analysis is dispatched instead of another fix round; a test shows the pause after N rounds.
- The rule counts rounds per item and compares each review's Important findings with the previous round's, so findings in code the previous round added count toward the chain; a test covers a chain and a carried-over finding.
- The run report and the ledger show rounds per item and each escalation.
- The merge policy says fail-open findings keep blocking after N rounds and fail-closed findings become follow-up items.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

A fix loop that patches one finding after another burns time and tokens on code that needed a redesign, and today only the owner notices, by eye, after several rounds. It serves the owner, who should be told early and not have to catch it.

## Notes

GitHub issue 584. rc.3 for the policy rule and the round count; the detection engine for classes of findings is rc.4 with the friction controller (HITLD-596). HITLD-934 took five fix rounds in this repository, each finding new problems in code the last round added.
