---
id: HITLD-1021
title: This repository has an AGENTS.md carrying the executor contract, so the briefs and the execute skill point at a file that exists
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `AGENTS.md` exists at the root of this repository with the contract block, and `hitld check contract` passes here; or, if the owner decides this repository keeps the contract elsewhere, the execute skill, the orchestrator's brief text and the executor guard's messages name that place instead of `AGENTS.md`.
- A test or `work check` rule fails when a skill names a contract file that the repository does not have.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-24 orch-12 could not read `AGENTS.md` in its checkout, and the chief of staff found that main has none and never had: `hitld check contract` says `no AGENTS.md; run hitld install`. The execute skill and every executor brief say to follow the executor contract in `AGENTS.md`. Executors have still produced correct work, so they rely on the skills and the brief text. [Likely: the contract text lives in the skills and in the private store, from the evidence that executors followed it; not checked in the store.] [Guessing: the file was deliberately left out of this repository, and the briefs never caught up.]

## Notes

rc.3. Needs the owner's call on where the contract lives before it is built, so the first step is a question, not code. Related: HITLD-1006.
