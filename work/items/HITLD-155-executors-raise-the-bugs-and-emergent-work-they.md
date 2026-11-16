---
id: HITLD-155
title: "Executors raise the bugs and emergent work they find: a found section in the report now, and proposed items they file themselves later"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

An executor reading and changing code finds bugs and work its item did not plan for. The design today says executors never create tracker entities, and that when they find new work they describe it in their report's "questions or follow-ups" (design 3, ID rules, rule 1). The report shape has a `questions` line, which is for questions to the owner, and no place for found work, so a finding is either lost, fixed silently outside the item, or buried in prose. The owner wants executors to file their own issues, or tell someone else to, as part of the design.

## Done when

- The design says how an executor raises the bugs and emergent work it finds. The owner decides each choice below with the design walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built:
  - Whether an executor may create items itself, or only report what it finds for the orchestrator to file. Today the executor row of the decision rights refuses creating tracker entities, and design 3 (ID rules) says executors describe new work in their report.
  - If it may create items: in which state, with what limits, and whether the orchestrator or the owner triages them.
  - If it reports: where in the report the finding goes. The report shape has `questions` and no place for found work.
  - Who files a reported finding: the orchestrator, the chief of staff, or the owner.
- Design 3 (ID rules), design 4 (the executor row) and design 5.6 (the report shape) say the chosen answer, in one change the owner approves.
- Then the build items follow, one per piece: the report check, the command if there is one, the skills and the contract block. The contract block and the report shape are part of the plugin's public interface.

## Notes

Raised by the owner in the chief of staff session. This item records the request and the open choices. It sets none of them: the owner said design choices about the system are theirs. The options a first walk-through could start from: report only (no rights change); report now, executors file `proposed` items later; executors file `proposed` items from the start. HITLD-136 and HITLD-147 also change the brief and the report, so settle this before they are built.
