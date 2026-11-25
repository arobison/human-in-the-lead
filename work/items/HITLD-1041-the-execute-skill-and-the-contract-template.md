---
id: HITLD-1041
title: The execute skill and the contract template name --budget-tokens in the claim command, with the brief's report-at figure
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when

- skills/execute/SKILL.md and templates/AGENTS.contract.md give the claim command with `--budget-tokens <the brief's report-at figure>` and `--branch`, in the same form as the brief; the contract block in AGENTS.md is regenerated and `hitld check contract` passes.
- A test or text check pins that the skill, the contract template and the brief render the same claim command.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-841 (a cloud executor's token cap travels in its claim commit) made the brief name `hitld work claim ... --budget-tokens <report-at>`. The execute skill and the contract template still give the claim without it, so a hand-written brief or an executor that follows the skill gets no enforcement where there is no store. The independent review of pull request 641 found the gap; the owner sent the pull request back and the fix left the skill alone, since a skill change needs the owner's own yes. [Certain: from the review and the executor's report.]

## Notes

rc.2 candidate (the owner decides): it closes the gap HITLD-841 leaves. A skill and contract-template change: the owner's own yes at merge. Follows HITLD-841.
