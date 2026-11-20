---
id: HITLD-562
title: A fact an executor reports comes from an independent source, and a rule it could break is enforced
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Why

Briefs tell executors what not to print or merge, and executors self-report facts such as tests passing or what they read. Tokens already moved to measure-do-not-ask (HITLD-438). The owner decided (HITLD-537) that every other rule and fact work that way.

## What it should do

- A rule an executor could break by accident is enforced by a hook or a scrubbed environment (HITLD-464 is the first).
- A fact comes from an independent source: CI for tests, git for what changed, the session record for tokens and what was read. A brief keeps only the purpose and the judgment calls.

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: HITLD-464, HITLD-438. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
