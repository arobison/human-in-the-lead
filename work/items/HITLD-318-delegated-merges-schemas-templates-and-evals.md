---
id: HITLD-318
title: "Delegated merges: schemas, templates and evals also take in their plugin copies"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Yes, copies follow their sources: Every generated copy follows its source area; the plugins area keeps only what is not a copy."
answered_at: 2026-11-16T06:46:19.205Z
answered_via: question-tool
answered_by: owner
---

## Question

The plugin build also copies schemas/, templates/ and evals/. Should those areas also take in their plugin copies, so approving a source area frees its copy?

PR #207 (HITLD-150); the same reasoning as HITLD-317 for core and skills.

## Options and recommendation

- A. Yes, copies follow their sources: Every generated copy follows its source area; the plugins area keeps only what is not a copy.
- B. No, only core and skills: Schemas, templates and evals changes keep waiting until the plugins area is approved.

Recommended: Yes, copies follow their sources. One rule for every generated copy.

## Answer

Recorded in the front matter once answered.
