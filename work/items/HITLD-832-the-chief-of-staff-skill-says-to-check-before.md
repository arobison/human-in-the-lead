---
id: HITLD-832
title: "The chief-of-staff skill says to check, before acting: required checks complete, a dependency's own dependencies, a tool's field names, and a feature's own docs"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-807]
constraint_of: [HITLD-67 c2]
---


## Why

On 2026-11-22 the chief of staff made six avoidable mistakes: it asked the owner to put HITLD-553 into rc.2 without checking that it needs HITLD-552 (the larger engine core); it merged a tracker pull request before its required check had finished (refused by the forge); it passed `sha` to the merge tool, whose field is `expectedHeadSha`, so the pin was probably ignored; it told the owner that stacked pull requests would not help before reading the forge's docs; it told the orchestrator that a curator pull request needed the owner's yes while the queue's delegation merged it anyway; and it explained a queued branch's missing line before knowing the queue works one branch per pass.

## Done when

- The chief-of-staff skill says: before merging, read the pull request's required checks and that every one is complete and green, and pin the head with the merge tool's real field (`expectedHeadSha`); before proposing to place an item in a milestone, read its `needs` and say what comes with it; before claiming a feature does or does not help, read its current documentation and say what could not be read; before telling the orchestrator a pull request needs the owner's yes, check the queue's delegation rule (`pullRequestWaits`) for its files.
- An eval or skill test reads the skill text for each rule.
- A skill change reaches main only with the owner's own yes. `hitld work check` and the offline eval gate pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
