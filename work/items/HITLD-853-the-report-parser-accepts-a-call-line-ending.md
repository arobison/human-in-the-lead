---
id: HITLD-853
title: The report parser refuses a (one-way) call line and says a one-way call goes under questions as a decision
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M864TVZEXA2WET
release_note: "A report call line not marked `(reversible)`, one marked `(one-way)` among them, is refused with a message that says a one-way call is not the executor's to make and goes under `questions` as a decision item (executor contract rule 5)."
---

## Why

On 2026-11-22 the HITLD-759 executor's report was refused four times by `dispatch complete`, once because a call line ended `(one-way)`. The item first said the contract and every brief allow a call line to end `(one-way)`, and asked the parser to accept it. That premise was false: the contract template (`templates/AGENTS.contract.md` rule 5 and its example), the brief (`core/lib/dispatch/brief.mjs`), the execute and curate skills and the design's execution part all mark a call `(reversible)` only, and rule 5 makes a one-way call the owner's, not the executor's: it goes under `questions` as a decision item. On review the owner decided to keep the refusal (2026-11-24). What was wrong is the message: `call not marked (reversible)` did not say where a one-way call goes, so the orchestrator had the executor move the one-way step into deviations.

## Done when

- `parseReport` still refuses a call line not marked `(reversible)`, `(one-way)` included, and records every call as reversible; the report schema keeps `reversible` as `const true`.
- The refusal names the line and says a one-way call is not the executor's to make and goes under `questions` as a decision item, pointing to executor contract rule 5 in AGENTS.md.
- A test pins the refusal of a `(one-way)` line and its message. No template, skill or design text changes. `npm run check`, the offline eval gate and `hitld work check` pass.
