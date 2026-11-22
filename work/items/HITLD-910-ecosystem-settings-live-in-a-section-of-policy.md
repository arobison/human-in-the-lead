---
id: HITLD-910
title: Ecosystem settings live in a section of policy.json
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. A section of policy.json: One trusted read path and one schema registry."
answered_at: 2026-11-22T20:49:07.441Z
answered_via: question-tool
answered_by: owner
---

## Question

Where do a project's ecosystem settings live (HITLD-883 decision 2 of 12)?

A new ecosystems section reuses policy validation and the rule that only owner configuration may hold command-like keys.

## Options and recommendation

- A. A section of policy.json: One trusted read path and one schema registry.
- B. A separate ecosystems file: A second trusted read path and schema registration.

Recommended: A section of policy.json. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
