---
id: HITLD-560
title: An executor is stuck by progress and over by budget, with a wall-clock backstop
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Why

Executors are judged by wall-clock limits (`dispatch.stall_after` 1800 seconds, `dispatch.deadline` 14400) although a session's event stream shows progress. The owner decided (HITLD-532) to use progress and budget.

## What it should do

- Stuck means no progress events (tool call, commit, token movement) for a set time; over means the token budget is spent. A wide wall-clock limit stays as a backstop for sessions that report nothing. A slow executor that is moving is left alone.

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: HITLD-493. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.
