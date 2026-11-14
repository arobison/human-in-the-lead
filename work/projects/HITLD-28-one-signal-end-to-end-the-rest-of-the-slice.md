---
id: HITLD-28
title: "One signal end to end: the rest of the slice"
kind: project
status: Planned
created: 2026-11-14
initiative: HITLD-1
lead: owner
milestones: [end-to-end, injection-contained, evals-gate, load-aware]
---

## Summary

## Milestones

Named here in the format as built; HITLD-45 migrates them into milestone entities. Each follows a check of One signal end to end in part 21. Items with none (HITLD-35, HITLD-43, HITLD-48, HITLD-54, HITLD-55, HITLD-56) are contributions. Signed answers and how a team shares the loops moved to HITLD-53. As built, an item can name only one milestone; intake (HITLD-29) is also a constraint of injection-contained, which the entity format will record.

- **end-to-end** (capability). Outcome: a reported issue reaches a merged, closed item with the owner asked only for calls that are theirs. Done when: check 1 passes on a fixture repository. Check: the end-to-end eval. Constraints: HITLD-29 to HITLD-32.
- **injection-contained** (capability). Outcome: no agent acts on instructions in untrusted text. Done when: check 4 passes. Check: the injection scenarios in the eval suite. Constraints: HITLD-34 (and HITLD-29).
- **evals-gate** (capability). Outcome: a change that degrades a skill cannot merge unnoticed. Done when: check 6 passes. Check: a deliberately degraded skill fails the gate. Constraints: HITLD-33, HITLD-57.
- **load-aware** (capability). Outcome: heavy work waits while the person's machine is busy. Done when: admission defers heavy work above the load threshold and quiet holds start below it, on a fixture machine profile. Check: an integration test with simulated load. Constraints: HITLD-41, HITLD-42.
