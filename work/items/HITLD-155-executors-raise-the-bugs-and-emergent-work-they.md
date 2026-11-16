---
id: HITLD-155
title: "Executors raise the bugs and emergent work they find: a found section in the report now, and proposed items they file themselves later"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-135]
---

## Why

An executor reading and changing code finds bugs and work its item did not plan for. The design today says executors never create tracker entities, and that when they find new work they describe it in their report's "questions or follow-ups" (design 3, ID rules, rule 1). The report shape has a `questions` line, which is for questions to the owner, and no place for found work, so a finding is either lost, fixed silently outside the item, or buried in prose. The owner wants executors to file their own issues, or tell someone else to, as part of the design.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner gave two instructions for the chief of staff, recorded as decisions in their own words:

- **Problems become work items (HITLD-181):** whenever the chief of staff runs into a problem, it checks the work items and makes one if needed. This belongs in the chief-of-staff instructions, and the owner said it is probably related to other agents filing issues as they go along, which is this item.
- **Items and milestones are kept current (HITLD-184):** the chief of staff updates milestones and work items as they change, until the curator agent of HITLD-132 does it.

## Done when

- The chief-of-staff skill says, on the owner's instructions above: when you meet a problem, search the tracker (`hitld work query --text`), file an item if none covers it (`proposed` when its fix is a design choice, `planned` when it is not), and tell the owner in one line what you filed; and keep milestones and work items current as work lands, scope changes and decisions are made, until the curator agent of HITLD-132 does it. The orchestrate skill says the same about the problems an orchestrator meets, and whether an executor does the same, or reports it, is decided in the walk-through below.
- The design says how an executor raises the bugs and emergent work it finds. The owner decides each choice below with the design walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built:
  - Whether an executor may create items itself, or only report what it finds for the orchestrator to file. Today the executor row of the decision rights refuses creating tracker entities, and design 3 (ID rules) says executors describe new work in their report.
  - If it may create items: in which state, with what limits, and whether the orchestrator or the owner triages them.
  - If it reports: where in the report the finding goes. The report shape has `questions` and no place for found work.
  - Who files a reported finding: the orchestrator, the chief of staff, or the owner.
- The chief-of-staff skill says it learns of new and changed items by pulling, not by being pushed: it queries the tracker for items created or changed since its last look at session start, at each hourly check-in, and before it answers the owner about the plan; the orchestrator's digest lists what it filed (decision of the owner, 2026-11-16, recorded as HITLD-213).
- When executors later earn the right to file `proposed` items themselves, the trust is per model type, since models differ in capability, not one level for all (the owner, 2026-11-16, recorded as HITLD-214). The later item carries this.
- Whoever reviews an executor's work may file items too, beyond sending fixes back to the executor, for example a bug the review uncovers in a part of the project unrelated to the task at hand (the owner, 2026-11-16, recorded as HITLD-215). The review skill and the decision rights say how, and the reviewer searches for a duplicate first.
- Design 3 (ID rules), design 4 (the executor row) and design 5.6 (the report shape) say the chosen answer, in one change the owner approves.
- Then the build items follow, one per piece: the report check, the command if there is one, the skills and the contract block. The contract block and the report shape are part of the plugin's public interface.

## Notes

Raised by the owner in the chief of staff session. This item records the request and the open choices. It sets none of them: the owner said design choices about the system are theirs. The options a first walk-through could start from: report only (no rights change); report now, executors file `proposed` items later; executors file `proposed` items from the start. HITLD-136 and HITLD-147 also change the brief and the report, so settle this before they are built.
